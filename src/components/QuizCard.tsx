"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export type QuizOption = {
  label: "A" | "B" | "C" | "D";
  text: string;
  isCorrect: boolean;
  explanation: string;
};

export type Quiz = {
  stem: string;
  scenarioType: "email" | "sms" | "website" | "social" | "call";
  options: QuizOption[];
  signals: string[];
  takeaway: string;
  hash: string;
};

export function QuizCard({
  quiz,
  selected,
  onSelect,
  showExplain,
}: {
  quiz: Quiz;
  selected: "A" | "B" | "C" | "D" | null;
  onSelect: (v: "A" | "B" | "C" | "D") => void;
  showExplain: boolean;
}) {
  const correct = quiz.options.find((o) => o.isCorrect)?.label ?? null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="text-xs uppercase tracking-widest text-white/60">
        Scenario: {quiz.scenarioType}
      </div>
      <h2 className="mt-2 text-xl font-semibold leading-snug">{quiz.stem}</h2>

      <div className="mt-5 grid gap-3">
        {quiz.options.map((o) => {
          const isPicked = selected === o.label;
          const isCorrect = o.isCorrect;

          return (
            <motion.button
              key={o.label}
              onClick={() => onSelect(o.label)}
              disabled={showExplain}
              className={cn(
                "w-full rounded-xl border px-4 py-3 text-left transition",
                "border-white/10 bg-black/30 hover:bg-white/10",
                showExplain && isCorrect && "border-white/50 bg-white/10",
                showExplain && isPicked && !isCorrect && "border-red-500/60 bg-red-500/10",
                showExplain && isPicked && isCorrect && "border-emerald-400/60 bg-emerald-400/10",
                !showExplain && isPicked && "border-white/40 bg-white/10"
              )}
              whileTap={{ scale: 0.99 }}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs">
                  {o.label}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{o.text}</div>

                  {showExplain && (
                    <div className="mt-2 text-sm text-white/75">
                      <span className="font-semibold">
                        {o.label === correct ? "✅ ถูก:" : "❌ ทำไมไม่ใช่:"}
                      </span>{" "}
                      {o.explanation}
                    </div>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {showExplain && (
        <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold">สัญญาณอันตรายที่ควรสังเกต</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
            {quiz.signals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="mt-3 text-sm text-white/80">
            <span className="font-semibold">จำง่าย:</span> {quiz.takeaway}
          </div>
        </div>
      )}
    </div>
  );
}
