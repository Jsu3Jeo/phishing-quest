"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { QuizCard, type Quiz } from "@/components/QuizCard";

type GameState = {
  score: number;
  answered: number;
  correct: number;
  wrong: number;
  historySignals: string[];
  historyStems: string[];
};

const STORAGE_KEY = "pq_game_v1";

function safeState(v: any): GameState {
  return {
    score: typeof v?.score === "number" ? v.score : 0,
    answered: typeof v?.answered === "number" ? v.answered : 0,
    correct: typeof v?.correct === "number" ? v.correct : 0,
    wrong: typeof v?.wrong === "number" ? v.wrong : 0,
    historySignals: Array.isArray(v?.historySignals) ? v.historySignals.map(String) : [],
    historyStems: Array.isArray(v?.historyStems) ? v.historyStems.map(String) : [],
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function GamePage() {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [selected, setSelected] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [state, setState] = useState<GameState>(() => loadState());
  const pointsPerCorrect = 10;

  const correctLabel = useMemo(() => {
    if (!quiz?.options?.length) return null;
    return quiz.options.find((o) => o.isCorrect)?.label ?? null;
  }, [quiz]);

  const didInit = useRef(false);

  const fetchNext = async () => {
    setErr(null);
    setLoading(true);
    setSelected(null);
    setShowExplain(false);

    try {
      const r = await fetch("/api/quiz/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recentSignals: (state.historySignals ?? []).slice(-10),
          recentStems: (state.historyStems ?? []).slice(-5),
        }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "สร้างโจทย์ไม่สำเร็จ");

      setQuiz(data.quiz as Quiz);
    } catch (e: any) {
      setErr(e?.message || "เกิดข้อผิดพลาด");
      setQuiz(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    fetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmAnswer = () => {
    if (!quiz || !selected || showExplain) return;
    if (!correctLabel) {
      setErr("โจทย์มีรูปแบบผิดพลาด (ไม่มีคำตอบที่ถูก) กดข้อต่อไป");
      setShowExplain(true);
      return;
    }

    setShowExplain(true);
    const isCorrect = selected === correctLabel;

    const next: GameState = {
      score: state.score + (isCorrect ? pointsPerCorrect : 0),
      answered: state.answered + 1,
      correct: state.correct + (isCorrect ? 1 : 0),
      wrong: state.wrong + (isCorrect ? 0 : 1),
      historySignals: [...(state.historySignals ?? []), ...(quiz.signals ?? [])].slice(-30),
      historyStems: [...(state.historyStems ?? []), quiz.stem].slice(-10),
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

    localStorage.setItem("pq_last_summary_v1", JSON.stringify(state));
    window.location.href = "/summary";
  };

  const resetLocal = () => {
    const fresh: GameState = safeState(null);
    setState(fresh);
    saveState(fresh);
    setSelected(null);
    setShowExplain(false);
    // fetch ใหม่แบบไม่พึ่ง state เก่า
    setTimeout(() => fetchNext(), 0);
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
            <button onClick={endGame} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
              จบเกม
            </button>
            <button onClick={resetLocal} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
              รีเซ็ต (คะแนนของคุณ)
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
      <LoadingOverlay show={loading} mode="local" text="กำลังสร้างโจทย์…" />

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
              onClick={fetchNext}
              disabled={!showExplain}
              className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10 disabled:opacity-40"
            >
              ข้อต่อไป
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
