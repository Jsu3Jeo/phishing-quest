"use client";

import { motion } from "framer-motion";

export function GlitchTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="pq-card pq-glow pq-scanline pq-shimmer relative overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="text-xs tracking-[0.25em] text-white/60"
      >
        READY PLAYER
      </motion.div>

      <div className="relative mt-2">
        <div className="text-3xl font-semibold tracking-tight md:text-4xl">
          {title}
        </div>

        {/* glitch layers */}
        <div
          className="pointer-events-none absolute inset-0 text-3xl font-semibold md:text-4xl"
          style={{
            color: "rgba(90,255,240,0.55)",
            transform: "translate(2px, 0)",
            animation: "pq-glitch 2.2s infinite linear",
            mixBlendMode: "screen",
            opacity: 0.55,
          }}
        >
          {title}
        </div>

        <div
          className="pointer-events-none absolute inset-0 text-3xl font-semibold md:text-4xl"
          style={{
            color: "rgba(120,130,255,0.55)",
            transform: "translate(-2px, 0)",
            animation: "pq-glitch 2.8s infinite linear",
            mixBlendMode: "screen",
            opacity: 0.45,
          }}
        >
          {title}
        </div>
      </div>

      {subtitle ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.35 }}
          className="mt-3 text-sm text-white/75"
        >
          {subtitle}
        </motion.div>
      ) : null}

      <motion.div
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70"
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 2.4, repeat: Infinity }}
      >
        <span className="h-2 w-2 rounded-full bg-white/60" />
        ฝึกให้ไว • ระวังให้เป็น
      </motion.div>
    </div>
  );
}
