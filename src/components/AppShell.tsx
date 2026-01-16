"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CyberBackground } from "@/components/CyberBackground";
import { GlitchTitle } from "@/components/GlitchTitle";
import { cn } from "@/lib/utils";

function NavButton({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "pq-btn text-sm",
        active && "border-white/30 bg-white/10"
      )}
    >
      {children}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };

  const active = (p: string) => pathname === p || pathname.startsWith(p + "/");

  // ซ่อน header บางหน้าถ้าคุณอยาก (เช่น login/signup)
  const hideHeader = pathname === "/login" || pathname === "/signup";

  return (
    <div className="relative min-h-screen">
      <CyberBackground />

      {/* super light animated noise */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-10"
        style={{
          backgroundImage:
            "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%2260%22 height=%2260%22 filter=%22url(%23n)%22 opacity=%220.35%22/%3E%3C/svg%3E')",
          animation: "pq-noise 2.6s infinite",
        }}
      />

      {!hideHeader && (
        <header className="relative z-10">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="group flex items-center gap-3">
              <motion.div
                className="pq-card pq-glow pq-scanline relative grid h-10 w-10 place-items-center overflow-hidden"
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 3.2, repeat: Infinity }}
              >
                <div className="text-sm font-semibold">PQ</div>
              </motion.div>

              <div className="leading-tight">
                <div className="text-[11px] tracking-[0.22em] text-white/60">
                  CYBER TRAINING
                </div>
                <div className="font-semibold">Phishing Quest</div>
              </div>
            </Link>

            <nav className="flex items-center gap-2">
              <NavButton href="/home" active={active("/home")}>
                Home
              </NavButton>
              <NavButton href="/scoreboard" active={active("/scoreboard")}>
                Scoreboard
              </NavButton>

              <button onClick={logout} className="pq-btn pq-btn-danger text-sm">
                Logout
              </button>
            </nav>
          </div>

          {/* tiny route badge */}
          <div className="mx-auto max-w-5xl px-4 pb-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
              <span className="h-2 w-2 rounded-full bg-white/60" />
              {pathname === "/home"
                ? "เลือกโหมดและเริ่มเล่น"
                : pathname.startsWith("/game")
                ? "โหมดปกติ"
                : pathname.startsWith("/inbox")
                ? "Inbox Mode"
                : pathname.startsWith("/scoreboard")
                ? "คะแนนรวม"
                : pathname.startsWith("/summary")
                ? "สรุปเกม"
                : "Phishing Quest"}
            </div>
          </div>
        </header>
      )}

      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
        {pathname === "/" && (
          <div className="mb-5">
            <GlitchTitle
              title="PHISHING QUEST"
              subtitle="ฝึกจับลิงก์ปลอม • อีเมลหลอก • ข้อความลวง แบบเกม"
            />
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(8px)" }}
            transition={{ duration: 0.22 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-white/60">
          Tip: อย่ากดลิงก์จากข้อความเร่งด่วน — เปิดแอป/เว็บทางการเองดีที่สุด
        </div>
      </footer>
    </div>
  );
}
