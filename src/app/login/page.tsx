"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { NeonButton } from "@/components/NeonButton";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    setErr(null);

    if (!email.trim() || !password) {
      setErr("กรอกอีเมลและรหัสผ่านก่อนนะ");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "ล็อกอินไม่สำเร็จ");

      window.location.href = data?.hasName ? "/home" : "/name";
    } catch (e: any) {
      setErr(e?.message || "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-[calc(100vh-160px)] place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <motion.div
          initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.25 }}
          className="pq-card pq-glow pq-scanline pq-shimmer relative overflow-hidden p-6"
        >
          <div className="pq-title">ACCESS</div>
          <h1 className="mt-2 text-2xl font-semibold">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-sm pq-text-muted">กลับมาเล่นต่อและสะสมคะแนน</p>

          <div className="mt-5 space-y-3">
            <input
              className="pq-input"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              inputMode="email"
              autoComplete="email"
            />

            <input
              className="pq-input"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoComplete="current-password"
            />

            {err && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {err}
              </div>
            )}

            <NeonButton onClick={submit} disabled={loading} className="w-full justify-center">
              {loading ? "กำลังเข้าสู่ระบบ..." : "Login"}
            </NeonButton>

            <div className="text-sm pq-text-muted">
              ยังไม่มีบัญชี?{" "}
              <Link href="/signup" className="text-white underline underline-offset-4">
                สมัครสมาชิก
              </Link>
            </div>
          </div>
        </motion.div>

        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3.2, repeat: Infinity }}
          className="pq-badge mx-auto w-fit"
        >
          <span className="h-2 w-2 rounded-full bg-white/60" />
          Tip: อย่ากดลิงก์จากข้อความเร่งด่วน
        </motion.div>
      </div>
    </div>
  );
}
