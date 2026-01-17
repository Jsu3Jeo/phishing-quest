"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { QuizCard, type Quiz } from "@/components/QuizCard";
import { sha256 } from "@/lib/utils";

type GameState = {
  score: number;
  answered: number;
  correct: number;
  wrong: number;
  historySignals: string[];
  historyStems: string[];
  recentHashes: string[];
};

const STORAGE_KEY = "pq_game_v2";

function safeState(v: any): GameState {
  return {
    score: typeof v?.score === "number" ? v.score : 0,
    answered: typeof v?.answered === "number" ? v.answered : 0,
    correct: typeof v?.correct === "number" ? v.correct : 0,
    wrong: typeof v?.wrong === "number" ? v.wrong : 0,
    historySignals: Array.isArray(v?.historySignals) ? v.historySignals.map(String) : [],
    historyStems: Array.isArray(v?.historyStems) ? v.historyStems.map(String) : [],
    recentHashes: Array.isArray(v?.recentHashes) ? v.recentHashes.map(String).filter(Boolean) : [],
  };
}

function loadState(): GameState {
  if (typeof window === "undefined") return safeState(null);
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return safeState(null);
  try {
    return safeState(JSON.parse(raw));
  } catch {
    return safeState(null);
  }
}

function saveState(s: GameState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function normalizeText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** ✅ hash แบบ stable (ไม่ขึ้นกับลำดับตัวเลือก) */
function computeClientHash(q: Quiz) {
  const stem = normalizeText((q as any)?.stem).toLowerCase();
  const opts = (q?.options ?? [])
    .map((o) => normalizeText(o.text).toLowerCase())
    .sort();
  return sha256(stem + "\n" + opts.join("\n"));
}

/** ✅ แปลงข้อมูลจาก API ให้ตรงกับ QuizCard type เสมอ (ใช้ whyCorrect) */
function coerceToUiQuiz(raw: any): Quiz {
  const stem = String(raw?.stem ?? "");
  const options = Array.isArray(raw?.options) ? raw.options : [];
  const signals = Array.isArray(raw?.signals) ? raw.signals.map(String) : [];
  const whyCorrect = String(
    raw?.whyCorrect ?? "สรุป: ตรวจโดเมน/ลิงก์ทางการ และอย่าให้ข้อมูลสำคัญ"
  );

  return {
    kind: "quiz",
    stem,
    options,
    signals,
    whyCorrect,
    hash: typeof raw?.hash === "string" ? raw.hash : undefined,
    source: raw?.source,
  };
}

export default function GameClient() {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [selected, setSelected] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [state, setState] = useState<GameState>(() => loadState());
  const stateRef = useRef<GameState>(state);

  const pointsPerCorrect = 10;

  const correctLabel = useMemo(() => {
    if (!quiz?.options?.length) return null;
    return quiz.options.find((o) => o.isCorrect)?.label ?? null;
  }, [quiz]);

  const didInit = useRef(false);
  const answeredRef = useRef(false);
  const submittingRef = useRef(false);
  const fetchingRef = useRef(false);

  // ✅ prefetch
  const prefetchedRef = useRef<Quiz | null>(null);
  const prefetchingRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const callNextApi = async (s: GameState): Promise<Quiz> => {
    const r = await fetch("/api/quiz/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answered: s.answered,
        freshOnly: true,
        recentHashes: (s.recentHashes ?? []).slice(-300),
        recentSignals: (s.historySignals ?? []).slice(-60),
        recentStems: (s.historyStems ?? []).slice(-80),
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || "สร้างโจทย์ไม่สำเร็จ");

    return coerceToUiQuiz(data.quiz);
  };

  /** ✅ อัปเดต stateRef แบบ sync กัน race condition */
  const pushHashSync = (hash: string) => {
    if (!hash) return;

    const cur = stateRef.current;
    const next: GameState = {
      ...cur,
      recentHashes: [...(cur.recentHashes ?? []), hash].filter(Boolean).slice(-400),
    };
    stateRef.current = next;
    setState(next);
    saveState(next);
  };

  const acceptQuiz = (q: Quiz) => {
    const h = (q as any)?.hash || computeClientHash(q);

    // ✅ ถ้าโจทย์ซ้ำใน session: ไม่รับ
    if ((stateRef.current.recentHashes ?? []).includes(h)) return false;

    const fixed: Quiz = {
      ...(q as any),
      kind: "quiz",
      hash: h,
      whyCorrect:
        (q as any)?.whyCorrect ||
        "สรุป: ตรวจโดเมน/ลิงก์ทางการ และอย่าให้ข้อมูลสำคัญ",
    };

    setQuiz(fixed);
    pushHashSync(h);
    return true;
  };

  const fetchNext = async (sArg?: GameState) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    setErr(null);
    setLoading(true);
    setSelected(null);
    setShowExplain(false);
    answeredRef.current = false;

    try {
      // ✅ ถ้ามี prefetch แล้ว ใช้ก่อน (เร็วมาก)
      if (prefetchedRef.current) {
        const q = prefetchedRef.current;
        prefetchedRef.current = null;

        const ok = acceptQuiz(q);
        if (!ok) {
          // ถ้า prefetched ดันซ้ำ -> ไปยิงใหม่
          // fall through
        } else {
          return;
        }
      }

      const s = sArg ?? stateRef.current;

      // ✅ กันซ้ำฝั่ง client เพิ่ม: ถ้า API ดันส่งซ้ำ ให้ลองใหม่สั้นๆ
      let got = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const q = await callNextApi(s);
        if (acceptQuiz(q)) {
          got = true;
          break;
        }
      }

      if (!got) {
        setQuiz(null);
        setErr("สุ่มได้โจทย์ซ้ำหลายครั้ง ลองกด “ลองใหม่” อีกที");
      }
    } catch (e: any) {
      setErr(e?.message || "เกิดข้อผิดพลาด");
      setQuiz(null);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  const prefetchNext = async () => {
    if (prefetchingRef.current) return;
    if (prefetchedRef.current) return;

    prefetchingRef.current = true;
    try {
      const s = stateRef.current;
      const q = await callNextApi(s);

      const h = (q as any)?.hash || computeClientHash(q);
      if ((stateRef.current.recentHashes ?? []).includes(h)) return;

      prefetchedRef.current = { ...(q as any), hash: h };
    } catch {
      prefetchedRef.current = null;
    } finally {
      prefetchingRef.current = false;
    }
  };

  const resetLocal = async () => {
    const prev = stateRef.current;

    const fresh: GameState = {
      score: 0,
      answered: 0,
      correct: 0,
      wrong: 0,
      // ✅ เก็บกันซ้ำข้ามเกม (ตามที่คุณต้องการ)
      historySignals: (prev.historySignals ?? []).slice(-120),
      historyStems: (prev.historyStems ?? []).slice(-120),
      recentHashes: (prev.recentHashes ?? []).slice(-400),
    };

    setState(fresh);
    stateRef.current = fresh;
    saveState(fresh);

    setSelected(null);
    setShowExplain(false);
    setQuiz(null);

    answeredRef.current = false;
    submittingRef.current = false;

    prefetchedRef.current = null;
    await fetchNext(fresh);
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const isNew =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("new") === "1";

    if (isNew) {
      resetLocal();
      return;
    }

    fetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmAnswer = () => {
    if (!quiz || !selected || showExplain) return;
    if (answeredRef.current) return;
    answeredRef.current = true;

    if (!correctLabel) {
      setErr("โจทย์มีรูปแบบผิดพลาด (ไม่มีคำตอบที่ถูก) กดข้อต่อไป");
      setShowExplain(true);
      return;
    }

    setShowExplain(true);
    const isCorrect = selected === correctLabel;

    setState((prev) => {
      const next: GameState = {
        score: prev.score + (isCorrect ? pointsPerCorrect : 0),
        answered: prev.answered + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
        historySignals: [...(prev.historySignals ?? []), ...(quiz.signals ?? [])].slice(-300),
        historyStems: [...(prev.historyStems ?? []), quiz.stem].slice(-250),
        recentHashes: prev.recentHashes ?? [],
      };
      stateRef.current = next;
      saveState(next);
      return next;
    });

    // ✅ เฉลยปุ๊บ prefetch ทันที
    setTimeout(() => prefetchNext(), 0);
  };

  const endGame = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const s = stateRef.current;

    await fetch("/api/score/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: s.score, questionsCount: s.answered, mode: "quiz" }),
    }).catch(() => {});

    if (typeof window !== "undefined") {
      localStorage.setItem("pq_last_summary_v1", JSON.stringify(s));
      window.location.href = "/summary";
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-white/70">Score</div>
            <div className="text-2xl font-semibold">{state.score}</div>
          </div>

          <div className="text-sm text-white/80">
            ตอบแล้ว: {state.answered} | ถูก: {state.correct} | ผิด: {state.wrong}
          </div>

          <div className="flex gap-2">
            <button
              onClick={endGame}
              className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
            >
              จบเกม
            </button>
            <button
              onClick={resetLocal}
              className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
            >
              เริ่มเกมใหม่
            </button>
          </div>
        </div>
      </div>

      <LoadingOverlay show={loading} mode="screen" text="กำลังสร้างโจทย์…" />

      {err && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
          <div className="mt-2">
            <button
              className="rounded-xl border border-white/15 px-3 py-2 hover:bg-white/10"
              onClick={() => fetchNext()}
            >
              ลองใหม่
            </button>
          </div>
        </div>
      )}

      {quiz && (
        <>
          <QuizCard
            quiz={quiz}
            selected={selected}
            onSelect={(v) => {
              if (showExplain) return;
              setSelected(v);
            }}
            showExplain={showExplain}
          />

          <div className="flex flex-wrap gap-3">
            <button
              onClick={confirmAnswer}
              disabled={!selected || showExplain}
              className="rounded-xl bg-white px-4 py-2 font-medium text-black hover:opacity-90 disabled:opacity-40"
            >
              ยืนยันคำตอบ
            </button>

            <button
              onClick={() => fetchNext()}
              disabled={!showExplain || loading}
              className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10 disabled:opacity-40"
            >
              ข้อต่อไป
            </button>

            <button
              onClick={endGame}
              className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10"
            >
              ไปหน้าสรุป
            </button>
          </div>
        </>
      )}
    </div>
  );
}
