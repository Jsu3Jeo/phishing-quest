"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

type SummaryState = {
  score: number;
  answered: number;
  correct: number;
  wrong: number;
  historySignals?: string[];
  historyStems?: string[];
};

export default function SummaryPage() {
  const [s, setS] = useState<SummaryState | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pq_last_summary_v1");
      if (raw) setS(JSON.parse(raw));
    } catch {
      setS(null);
    }
  }, []);

  const signals = useMemo(() => {
    const arr = Array.isArray(s?.historySignals) ? s!.historySignals! : [];
    return Array.from(new Set(arr)).slice(0, 18);
  }, [s]);

  const acc = useMemo(() => {
    if (!s || !s.answered) return 0;
    return Math.round((s.correct / s.answered) * 100);
  }, [s]);

  return (
    <div className="space-y-4">
      <div className="pq-card pq-glow pq-scanline p-6">
        <div className="pq-title">MISSION REPORT</div>
        <h1 className="mt-2 text-2xl font-semibold">สรุปผลการเล่น</h1>
        <p className="mt-1 text-sm pq-text-muted">อ่านทริคแล้วกดเล่นต่อเพื่อทำคะแนนเพิ่มได้เลย</p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <motion.div
            className="pq-card p-4"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 3.1, repeat: Infinity }}
          >
            <div className="text-sm pq-text-muted">คะแนนรอบนี้</div>
            <div className="mt-1 text-3xl font-semibold">{s?.score ?? 0}</div>
          </motion.div>

          <div className="pq-card p-4">
            <div className="text-sm pq-text-muted">ตอบแล้ว</div>
            <div className="mt-1 text-3xl font-semibold">{s?.answered ?? 0}</div>
          </div>

          <div className="pq-card p-4">
            <div className="text-sm pq-text-muted">ความแม่นยำ</div>
            <div className="mt-1 text-3xl font-semibold">{acc}%</div>
            <div className="mt-1 text-xs text-white/60">
              ถูก {s?.correct ?? 0} | ผิด {s?.wrong ?? 0}
            </div>
          </div>
        </div>
      </div>

      <div className="pq-card p-6">
        <div className="text-sm font-semibold">ทริคที่ควรจำ (จากสิ่งที่เจอ)</div>
        {signals.length === 0 ? (
          <div className="mt-2 text-sm pq-text-muted">
            ยังไม่มีทริค (ลองเล่น Inbox Mode จะได้ red flags เยอะมาก)
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {signals.map((x, i) => (
              <li key={i} className="pq-badge">
                ⚠️ {x}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/home" className="pq-btn pq-btn-primary">
          กลับหน้าเลือกโหมด
        </Link>
        <Link href="/scoreboard" className="pq-btn">
          ดู Scoreboard
        </Link>
      </div>
    </div>
  );
}
