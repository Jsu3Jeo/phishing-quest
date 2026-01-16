"use client";

import { useEffect, useState } from "react";

export default function NamePage() {
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // if already logged in and has name, go home
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user?.displayName) window.location.href = "/home";
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch("/api/profile/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "ตั้งชื่อไม่สำเร็จ");

      window.location.href = "/home";
    } catch (e: any) {
      setErr(e?.message || "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">ตั้งชื่อสำหรับ Scoreboard</h1>
        <p className="mt-1 text-sm text-white/70">
          ชื่อนี้ต้องไม่ซ้ำ (2–20 ตัวอักษร)
        </p>

        <div className="mt-5 space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-white/30"
            placeholder="เช่น CyberNana"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          {err && <div className="text-sm text-red-300">{err}</div>}

          <button
            onClick={submit}
            disabled={loading}
            className="w-full rounded-xl bg-white px-4 py-2 font-medium text-black hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "กำลังบันทึก..." : "ยืนยันชื่อ"}
          </button>
        </div>
      </div>
    </div>
  );
}
