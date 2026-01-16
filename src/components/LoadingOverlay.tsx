"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export function LoadingOverlay({
  show,
  text = "กำลังสร้างโจทย์…",
  mode = "screen", // "screen" | "local"
  className,
}: {
  show: boolean;
  text?: string;
  mode?: "screen" | "local";
  className?: string;
}) {
  const wrapperClass =
    mode === "screen"
      ? "fixed inset-0 z-50"
      : "absolute inset-0 z-10 rounded-2xl";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn(wrapperClass, className)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* dim */}
          <div className="absolute inset-0 rounded-2xl bg-black/55 backdrop-blur-sm" />

          {/* center panel */}
          <motion.div
            className="absolute left-1/2 top-1/2 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-white/5 p-5 text-center"
            initial={{ scale: 0.98, y: 6, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, y: 6, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
            <div className="text-sm font-semibold">{text}</div>
            <div className="mt-1 text-xs text-white/60">โปรดรอสักครู่…</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
