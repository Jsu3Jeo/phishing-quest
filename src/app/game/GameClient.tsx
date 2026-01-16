"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function GameClient() {
  const params = useSearchParams();

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

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fetchNext = async (sArg?: GameState) => {
    setErr(null);
    setLoading(true);
    setSelected(null);
    setShowExplain(false);
    answeredRef.current = false;

    const s = sArg ?? stateRef.current;

    try {
      const r = await fetch("/api/quiz/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recentSignals: (s.historySignals ?? []).slice(-12),
          recentStems: (s.historyStems ?? []).slice(-10),
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

  const resetLocal = async () => {
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);

    const fresh = safeState(null);
    setState(fresh);
    stateRef.current = fresh;

    setSelected(null);
    setShowExplain(false);
    setQuiz(null);

    answeredRef.current = false;
    submittingRef.current = false;

    await fetchNext(fresh);
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    if (params.get("new") === "1") {
      resetLocal(); // reset แล้ว fetchNext(fresh) ในตัว
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
        historySignals: [...(prev.historySignals ?? []), ...(quiz.signals ?? [])].slice(-40),
        historyStems: [...(prev.historyStems ?? []), quiz.stem].slice(-20),
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
      body: JSON.stringify({ score: s.score, questionsCount: s.answered, mode: "quiz" }),
    }).catch(() => {});

    if (typeof window !== "undefined") {
      localStorage.setItem("pq_last_summary_v1", JSON.stringify(s));
      localStorage.removeItem(STORAGE_KEY); // ✅ จบเกมล้าง local score
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
            <button onClick={endGame} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
              จบเกม
            </button>
            <button onClick={resetLocal} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
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
            <button className="rounded-xl border border-white/15 px-3 py-2 hover:bg-white/10" onClick={() => fetchNext()}>
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