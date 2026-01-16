"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Me = {
  user: null | { displayName: string | null; totalScore: number; gamesPlayed: number; email: string };
};

export function Navbar() {
  const [me, setMe] = useState<Me["user"]>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => setMe(d?.user ?? null))
      .catch(() => setMe(null));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <header className="relative z-10 border-b border-white/10 bg-black/30 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Phishing Quest
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          <Link href="/home" className="text-white/80 hover:text-white">
            Home
          </Link>
          <Link href="/scoreboard" className="text-white/80 hover:text-white">
            Scoreboard
          </Link>

          {me ? (
            <button
              onClick={logout}
              className="rounded-xl border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            >
              ออกจากระบบ
            </button>
          ) : (
            <>
              <Link href="/login" className="text-white/80 hover:text-white">
                Login
              </Link>
              <Link
                href="/signup"
                className="rounded-xl bg-white px-3 py-1.5 text-black hover:opacity-90"
              >
                Signup
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
