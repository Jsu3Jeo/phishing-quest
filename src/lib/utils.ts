import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import crypto from "crypto";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function safeJsonParse<T>(text: string): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || "JSON parse failed" };
  }
}
