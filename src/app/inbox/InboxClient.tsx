"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { MessageCard, type InboxItem } from "@/components/MessageCard";

type Verdict = "legit" | "phishing";

type InboxState = {
  score: number;
  answered: number;
  correct: number;
  wrong: number;
  recentHashes: string[]; // เก็บไว้ได้ แต่ไม่ใช้กันซ้ำแล้ว
  recentVerdicts: Verdict[];
  redFlagsSeen: string[];
  recentTexts: string[];
};

const STORAGE_KEY = "pq_inbox_v3";

const DEFAULT_STATE: InboxState = {
  score: 0,
  answered: 0,
  correct: 0,
  wrong: 0,
  recentHashes: [],
  recentVerdicts: [],
  redFlagsSeen: [],
  recentTexts: [],
};

function coerceState(input: any): InboxState {
  return {
    score: typeof input?.score === "number" ? input.score : 0,
    answered: typeof input?.answered === "number" ? input.answered : 0,
    correct: typeof input?.correct === "number" ? input.correct : 0,
    wrong: typeof input?.wrong === "number" ? input.wrong : 0,
    recentHashes: Array.isArray(input?.recentHashes) ? input.recentHashes.map(String).filter(Boolean) : [],
    recentVerdicts: Array.isArray(input?.recentVerdicts)
      ? input.recentVerdicts
          .map((v: any) => (v === "legit" ? "legit" : v === "phishing" ? "phishing" : null))
          .filter(Boolean)
      : [],
    redFlagsSeen: Array.isArray(input?.redFlagsSeen) ? input.redFlagsSeen.map(String).filter(Boolean) : [],
    recentTexts: Array.isArray(input?.recentTexts) ? input.recentTexts.map(String).filter(Boolean) : [],
  };
}

function loadState(): InboxState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_STATE;
  try {
    return coerceState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(s: InboxState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function InboxClient() {
  const [item, setItem] = useState<InboxItem | null>(null);
  const [picked, setPicked] = useState<Verdict | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  const [state, setState] = useState<InboxState>(() => loadState());
  const stateRef = useRef<InboxState>(state);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pointsPerCorrect = 15;

  const didInit = useRef(false);
  const answeredRef = useRef(false);
  const submittingRef = useRef(false);
  const fetchingRef = useRef(false);

  // prefetch
  const prefetchedRef = useRef<InboxItem | null>(null);
  const prefetchingRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const callNextApi = async (s: InboxState): Promise<InboxItem> => {
    const r = await fetch("/api/inbox/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answered: s.answered, // ✅ สำคัญ: ให้ server ใช้ answered % 20
        recentVerdicts: (s.recentVerdicts ?? []).slice(-200),
        recentTexts: (s.recentTexts ?? []).slice(-200),
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || "สร้างข้อความไม่สำเร็จ");
    return data.item as InboxItem;
  };

  /** ✅ sync update กัน race */
  const pushMetaSync = (hash: string, packedText: string) => {
    const cur = stateRef.current;

    const next: InboxState = {
      ...cur,
      recentHashes: [...(cur.recentHashes ?? []), hash].filter(Boolean).slice(-600),
      recentTexts: [...(cur.recentTexts ?? []), packedText].filter(Boolean).slice(-200),
    };

    stateRef.current = next;
    setState(next);
    saveState(next);
  };

  const acceptItem = (it: InboxItem) => {
    const h = String((it as any)?.hash ?? "");
    const packed = `${(it as any)?.subject ?? ""}\n${(it as any)?.body ?? ""}`.trim();

    // ✅ รับมาใช้เลย ไม่กันซ้ำ (เพราะต้องวน 20 ข้อได้)
    setItem(it);
    pushMetaSync(h, packed);
  };

  const fetchNext = async (sArg?: InboxState) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    setErr(null);
    setLoading(true);
    setPicked(null);
    setShowExplain(false);
    answeredRef.current = false;

    try {
      // ✅ ใช้ prefetch ก่อน (เร็ว)
      if (prefetchedRef.current) {
        const it = prefetchedRef.current;
        prefetchedRef.current = null;
        acceptItem(it);
        return;
      }

      const s = sArg ?? stateRef.current;
      const it = await callNextApi(s);

      acceptItem(it);
    } catch (e: any) {
      setErr(e?.message || "เกิดข้อผิดพลาด");
      setItem(null);
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
      const it = await callNextApi(s);
      prefetchedRef.current = it;
    } catch {
      prefetchedRef.current = null;
    } finally {
      prefetchingRef.current = false;
    }
  };

  const resetLocal = async () => {
    const fresh: InboxState = {
      score: 0,
      answered: 0,
      correct: 0,
      wrong: 0,
      recentHashes: [],
      recentVerdicts: [],
      redFlagsSeen: [],
      recentTexts: [],
    };

    setState(fresh);
    stateRef.current = fresh;
    saveState(fresh);

    setPicked(null);
    setShowExplain(false);
    setItem(null);

    answeredRef.current = false;
    submittingRef.current = false;

    prefetchedRef.current = null;
    await fetchNext(fresh);
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const isNew =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";

    if (isNew) {
      resetLocal();
      return;
    }

    fetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = () => {
    if (!item || !picked || showExplain) return;
    if (answeredRef.current) return;
    answeredRef.current = true;

    setShowExplain(true);
    const isCorrect = picked === (item as any).verdict;

    setState((prev) => {
      const next: InboxState = {
        ...prev,
        score: prev.score + (isCorrect ? pointsPerCorrect : 0),
        answered: prev.answered + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
        recentVerdicts: [...(prev.recentVerdicts ?? []), (item as any).verdict].slice(-200),
        redFlagsSeen: [...(prev.redFlagsSeen ?? []), ...(((item as any).redFlags ?? []) as string[])].slice(-400),
      };
      stateRef.current = next;
      saveState(next);
      return next;
    });

    // ✅ เฉลยปุ๊บ prefetch ถัดไป
    setTimeout(() => prefetchNext(), 0);
  };

  const endGame = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const s = stateRef.current;

    await fetch("/api/score/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: s.score, questionsCount: s.answered, mode: "inbox" }),
    }).catch(() => {});

    if (typeof window !== "undefined") {
      localStorage.setItem(
        "pq_last_summary_v1",
        JSON.stringify({
          score: s.score,
          answered: s.answered,
          correct: s.correct,
          wrong: s.wrong,
          historySignals: Array.from(new Set(s.redFlagsSeen ?? [])).slice(0, 30),
          historyStems: [],
        })
      );
      window.location.href = "/summary";
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-white/70">Inbox Mode</div>
            <div className="text-2xl font-semibold">{state.score} pts</div>
            <div className="mt-1 text-xs text-white/60">ถูก 1 ข้อ = {pointsPerCorrect} คะแนน</div>
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

      <LoadingOverlay show={loading} mode="screen" text="กำลังสุ่มอีเมล/ข้อความ…" />

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

      {item && (
        <>
          <MessageCard
            item={item}
            picked={picked}
            showExplain={showExplain}
            onPick={(v) => {
              if (showExplain) return;
              setPicked(v);
            }}
          />

          <div className="flex flex-wrap gap-3">
            <button
              onClick={confirm}
              disabled={!picked || showExplain}
              className="rounded-xl bg-white px-4 py-2 font-medium text-black hover:opacity-90 disabled:opacity-40"
            >
              ยืนยันคำตอบ
            </button>

            <button
              onClick={() => fetchNext()}
              disabled={!showExplain || loading}
              className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10 disabled:opacity-40"
            >
              ข้อถัดไป
            </button>

            <button onClick={endGame} className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10">
              ไปหน้าสรุป
            </button>
          </div>
        </>
      )}
    </div>
  );
}
