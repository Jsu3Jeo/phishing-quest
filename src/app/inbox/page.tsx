"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { MessageCard, type InboxItem } from "@/components/MessageCard";

type Verdict = "legit" | "phishing";

type InboxState = {
  score: number;
  answered: number;
  correct: number;
  wrong: number;
  recentHashes: string[];
  recentVerdicts: Verdict[];
  redFlagsSeen: string[];
};

const STORAGE_KEY = "pq_inbox_v2";

const DEFAULT_STATE: InboxState = {
  score: 0,
  answered: 0,
  correct: 0,
  wrong: 0,
  recentHashes: [],
  recentVerdicts: [],
  redFlagsSeen: [],
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

export default function InboxModePage() {
  const params = useSearchParams();

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

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fetchNext = async () => {
    setErr(null);
    setLoading(true);
    setPicked(null);
    setShowExplain(false);
    answeredRef.current = false;

    const s = stateRef.current;

    try {
      const recentHashes = (s.recentHashes ?? []).slice(-20);
      const recentVerdicts = (s.recentVerdicts ?? []).slice(-12);

      const r = await fetch("/api/inbox/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recentHashes, recentVerdicts }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "สร้างข้อความไม่สำเร็จ");
      setItem(data.item as InboxItem);
    } catch (e: any) {
      setErr(e?.message || "เกิดข้อผิดพลาด");
      setItem(null);
    } finally {
      setLoading(false);
    }
  };

  const resetLocal = () => {
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
    setState(DEFAULT_STATE);
    stateRef.current = DEFAULT_STATE;
    setPicked(null);
    setShowExplain(false);
    setItem(null);
    answeredRef.current = false;
    submittingRef.current = false;
    setTimeout(() => fetchNext(), 0);
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // ✅ เข้า /inbox?new=1 -> รีเซ็ตก่อน
    if (params.get("new") === "1") {
      resetLocal();
      return;
    }

    fetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = () => {
    if (!item || !picked || showExplain) return;

    // ✅ กันกดซ้ำเร็ว ๆ
    if (answeredRef.current) return;
    answeredRef.current = true;

    setShowExplain(true);
    const isCorrect = picked === item.verdict;

    setState((prev) => {
      const next: InboxState = {
        score: prev.score + (isCorrect ? pointsPerCorrect : 0),
        answered: prev.answered + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
        recentHashes: [...(prev.recentHashes ?? []), item.hash].slice(-40),
        recentVerdicts: [...(prev.recentVerdicts ?? []), item.verdict].slice(-40),
        redFlagsSeen: [...(prev.redFlagsSeen ?? []), ...(item.redFlags ?? [])].slice(-120),
      };
      stateRef.current = next;
      saveState(next);
      return next;
    });
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

      // ✅ จบเกมแล้วล้างคะแนนในเครื่องทันที
      localStorage.removeItem(STORAGE_KEY);
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
            <button onClick={endGame} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
              จบเกม
            </button>
            <button onClick={resetLocal} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
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
            <button className="rounded-xl border border-white/15 px-3 py-2 hover:bg-white/10" onClick={fetchNext}>
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
              onClick={fetchNext}
              disabled={!showExplain}
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
