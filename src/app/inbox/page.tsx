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
  recentHashes: string[];
  recentVerdicts: Verdict[];
  redFlagsSeen: string[];
};

// ✅ เปลี่ยนเป็น v2 กันชนกับข้อมูลเก่า
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
    const parsed = JSON.parse(raw);
    return coerceState(parsed);
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(s: InboxState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function InboxModePage() {
  const [item, setItem] = useState<InboxItem | null>(null);
  const [picked, setPicked] = useState<Verdict | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  const [state, setState] = useState<InboxState>(() => loadState());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pointsPerCorrect = 15;

  const didInit = useRef(false);

  const fetchNext = async () => {
    setErr(null);
    setLoading(true);
    setPicked(null);
    setShowExplain(false);

    try {
      const recentHashes = (state.recentHashes ?? []).slice(-12);
      const recentVerdicts = (state.recentVerdicts ?? []).slice(-8);

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

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    setTimeout(() => fetchNext(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = () => {
    if (!item || !picked || showExplain) return;

    setShowExplain(true);
    const isCorrect = picked === item.verdict;

    const next: InboxState = {
      score: state.score + (isCorrect ? pointsPerCorrect : 0),
      answered: state.answered + 1,
      correct: state.correct + (isCorrect ? 1 : 0),
      wrong: state.wrong + (isCorrect ? 0 : 1),
      recentHashes: [...(state.recentHashes ?? []), item.hash].slice(-30),
      recentVerdicts: [...(state.recentVerdicts ?? []), item.verdict].slice(-30),
      redFlagsSeen: [...(state.redFlagsSeen ?? []), ...(item.redFlags ?? [])].slice(-80),
    };

    setState(next);
    saveState(next);
  };

  const endGame = async () => {
    await fetch("/api/score/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: state.score, questionsCount: state.answered }),
    }).catch(() => {});

    localStorage.setItem(
      "pq_last_summary_v1",
      JSON.stringify({
        score: state.score,
        answered: state.answered,
        correct: state.correct,
        wrong: state.wrong,
        historySignals: Array.from(new Set(state.redFlagsSeen ?? [])).slice(0, 30),
        historyStems: [],
      })
    );

    window.location.href = "/summary";
  };

  const resetLocal = () => {
    setState(DEFAULT_STATE);
    saveState(DEFAULT_STATE);
    setPicked(null);
    setShowExplain(false);
    fetchNext();
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
              รีเซ็ต (ในเครื่อง)
            </button>
          </div>
        </div>
      </div>

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

<div className="relative"></div>
      <LoadingOverlay show={loading} mode="local" text="กำลังสุ่มอีเมล/ข้อความ…" />
      
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
