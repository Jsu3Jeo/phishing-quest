"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

type Row = {
  displayName: string;
  totalScore: number;
  gamesPlayed: number;
  updatedAt: string;
};

function medal(i: number) {
  if (i === 0) return "🏆";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "🎮";
}

export default function ScoreboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scoreboard")
      .then((r) => r.json())
      .then((d) => setRows(d.top ?? []))
      .finally(() => setLoading(false));
  }, []);

  const top3 = useMemo(() => rows.slice(0, 3), [rows]);

  return (
    <div className="space-y-4">
      <div className="pq-card pq-glow pq-scanline p-6">
        <div className="pq-title">LEADERBOARD</div>
        <h1 className="mt-2 text-2xl font-semibold">Scoreboard</h1>
        <p className="mt-1 text-sm pq-text-muted">คะแนนสะสมรวมทุกเกม</p>
      </div>

      {/* Top 3 */}
      {!loading && top3.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {top3.map((r, i) => (
            <motion.div
              key={r.displayName}
              className="pq-card pq-glow p-5"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3.2 + i * 0.3, repeat: Infinity }}
            >
              <div className="pq-title">
                {medal(i)} RANK {i + 1}
              </div>
              <div className="mt-2 text-lg font-semibold">{r.displayName}</div>
              <div className="mt-3 flex items-center justify-between">
                <div className="pq-badge">Score: {r.totalScore}</div>
                <div className="text-xs pq-text-muted">{r.gamesPlayed} games</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="pq-card p-4">
        {loading ? (
          <div className="p-4 pq-text-muted">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="p-4 pq-text-muted">ยังไม่มีคะแนนในระบบ</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/70">
                <tr className="border-b border-white/10">
                  <th className="p-3">อันดับ</th>
                  <th className="p-3">ชื่อ</th>
                  <th className="p-3">คะแนนรวม</th>
                  <th className="p-3">เล่นไป</th>
                  <th className="p-3">อัปเดตล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.displayName}
                    className={[
                      "border-t border-white/10",
                      i < 3 ? "bg-white/5" : "",
                    ].join(" ")}
                  >
                    <td className="p-3">{i + 1}</td>
                    <td className="p-3 font-medium">
                      <span className="mr-2">{medal(i)}</span>
                      {r.displayName}
                    </td>
                    <td className="p-3">{r.totalScore}</td>
                    <td className="p-3">{r.gamesPlayed}</td>
                    <td className="p-3 text-white/60">
                      {new Date(r.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
