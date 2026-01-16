"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type GameState = {
  score: number;
  answered: number;
  correct: number;
  wrong: number;
  historySignals: string[];
  historyStems: string[];
};

export default function SummaryPage() {
  const [s, setS] = useState<GameState | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("pq_last_summary_v1");
    if (!raw) return;
    try {
      setS(JSON.parse(raw));
    } catch {}
  }, []);

  const accuracy = useMemo(() => {
    if (!s || s.answered === 0) return 0;
    return Math.round((s.correct / s.answered) * 100);
  }, [s]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">สรุปผล</h1>
        <p className="mt-1 text-sm text-white/70">
          คะแนนเกมนี้ถูกบันทึกสะสมลง Scoreboard แล้ว
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/60">คะแนน</div>
            <div className="mt-1 text-2xl font-semibold">{s?.score ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/60">ตอบแล้ว</div>
            <div className="mt-1 text-2xl font-semibold">{s?.answered ?? 0}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/60">ความแม่น</div>
            <div className="mt-1 text-2xl font-semibold">{accuracy}%</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/60">สรุป</div>
            <div className="mt-1 text-sm text-white/80">
              อ่าน “เหตุผล” ทุกข้อ แล้วจำ pattern ของมิจฉาชีพ
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/game"
            className="rounded-xl bg-white px-4 py-2 font-medium text-black hover:opacity-90"
          >
            เล่นต่อ
          </Link>
          <Link
            href="/scoreboard"
            className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10"
          >
            ไป Scoreboard
          </Link>
          <Link
            href="/home"
            className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10"
          >
            กลับ Home
          </Link>
        </div>
      </div>

      {s?.historySignals?.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-lg font-semibold">สัญญาณอันตรายที่คุณเจอบ่อย</div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
            {Array.from(new Set(s.historySignals)).slice(0, 12).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
