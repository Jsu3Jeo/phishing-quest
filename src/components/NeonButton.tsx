"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type MotionButtonProps = Omit<HTMLMotionProps<"button">, "children">;

type Props = MotionButtonProps & {
  children: React.ReactNode; // ✅ บังคับให้เป็น ReactNode จริง ๆ
  glow?: boolean;
};

export function NeonButton({ children, className, glow = true, ...props }: Props) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "group relative overflow-hidden rounded-xl px-4 py-2 font-semibold",
        "border border-white/10 bg-white text-black hover:opacity-95 disabled:opacity-40",
        glow &&
          "shadow-[0_0_0_1px_rgba(255,255,255,.12),0_18px_60px_rgba(0,0,0,.35),0_0_44px_rgba(90,255,240,.18)]",
        className
      )}
      {...props}
    >
      <span className="relative z-10">{children}</span>
      <span
        className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(600px 200px at 20% 0%, rgba(90,255,240,0.35), transparent 60%), radial-gradient(600px 200px at 80% 100%, rgba(120,130,255,0.30), transparent 60%)",
        }}
      />
    </motion.button>
  );
}
