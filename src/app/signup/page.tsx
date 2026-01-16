"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { NeonButton } from "@/components/NeonButton";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    setErr(null);

    const e = email.trim().toLowerCase();
    if (!e) {
      setErr("กรอกอีเมลก่อนนะ");
      return;
    }
    if (!password || password.length < 6) {
      setErr("รหัสผ่านอย่างน้อย 6 ตัวอักษร");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, password }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "สมัครไม่สำเร็จ");

      window.location.href = "/name";
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
          <div className="pq-title">NEW PLAYER</div>
          <h1 className="mt-2 text-2xl font-semibold">สมัครสมาชิก</h1>
          <p className="mt-1 text-sm pq-text-muted">เริ่มเล่นเกมฝึกจับ phishing</p>

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
              placeholder="Password (>= 6 ตัว)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoComplete="new-password"
            />

            {err && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {err}
              </div>
            )}

            <NeonButton onClick={submit} disabled={loading} className="w-full justify-center">
              {loading ? "กำลังสมัคร..." : "สมัคร"}
            </NeonButton>

            <div className="text-sm pq-text-muted">
              มีบัญชีแล้ว?{" "}
              <Link href="/login" className="text-white underline underline-offset-4">
                เข้าสู่ระบบ
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
          Tip: ตั้งรหัสผ่านไม่ซ้ำเว็บอื่น
        </motion.div>
      </div>
    </div>
  );
}
