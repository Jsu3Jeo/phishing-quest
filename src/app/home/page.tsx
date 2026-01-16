"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function HomePage() {
  const [me, setMe] = useState<{ displayName: string; totalScore: number; gamesPlayed: number } | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .catch(() => setMe(null));
  }, []);

  return (
    <div className="space-y-6">
      <div className="pq-card pq-glow pq-scanline p-6">
        <div className="pq-title">PLAYER HUB</div>
        <div className="mt-2 text-sm pq-text-muted">ยินดีต้อนรับ</div>
        <div className="mt-1 text-2xl font-semibold">{me?.displayName ?? "..."}</div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <motion.div
            className="pq-card pq-scanline p-4"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 3.6, repeat: Infinity }}
          >
            <div className="text-sm pq-text-muted">คะแนนสะสม</div>
            <div className="mt-1 text-2xl font-semibold">{me?.totalScore ?? 0}</div>
          </motion.div>

          <div className="pq-card p-4">
            <div className="text-sm pq-text-muted">จำนวนเกมที่เล่น</div>
            <div className="mt-1 text-2xl font-semibold">{me?.gamesPlayed ?? 0}</div>
          </div>

          <div className="pq-card p-4">
            <div className="text-sm pq-text-muted">เป้าหมาย</div>
            <div className="mt-2 text-sm text-white/80">
              ตอบให้ถูกต่อเนื่อง + อ่านเหตุผลทุกข้อ แล้วคุณจะ “รู้ทันมิจฉาชีพ” ได้จริง
            </div>
          </div>
        </div>
      </div>

      {/* Mission Select */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div
          whileHover={{ y: -2 }}
          className="pq-card pq-glow p-6"
        >
          <div className="pq-title">MISSION 01</div>
          <div className="mt-2 text-xl font-semibold">โหมดปกติ (Quiz)</div>
          <p className="mt-2 text-sm pq-text-muted">
            ตอบคำถาม A B C D พร้อมเฉลยทุกข้อ ฝึกสังเกต “สัญญาณ phishing”
          </p>

          <div className="mt-4 flex items-center justify-between">
            <div className="pq-badge">10 pts / ข้อ</div>
            <Link href="/game?new=1" className="pq-btn pq-btn-primary">
              เริ่มโหมดนี้
            </Link>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="pq-card pq-glow p-6"
        >
          <div className="pq-title">MISSION 02</div>
          <div className="mt-2 text-xl font-semibold">Inbox Mode</div>
          <p className="mt-2 text-sm pq-text-muted">
            ดู “อีเมล/ข้อความ” สมจริง แล้วตัดสินว่า Legit หรือ Phishing
          </p>

          <div className="mt-4 flex items-center justify-between">
            <div className="pq-badge">15 pts / ข้อ</div>
            <Link href="/inbox" className="pq-btn pq-btn-primary">
              เริ่มโหมดนี้
            </Link>
          </div>
        </motion.div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/scoreboard" className="pq-btn">
          ดู Scoreboard
        </Link>
      </div>
    </div>
  );
}
