"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export type InboxItem = {
  channel: "email" | "sms";
  from: string;
  to?: string;
  subject?: string;
  body: string;
  links: Array<{ text: string; url: string }>;
  attachments?: string[];
  verdict: "legit" | "phishing";
  explanation: string;
  redFlags: string[];
  safeActions: string[];
  hash: string;
};

export function MessageCard({
  item,
  picked,
  showExplain,
  onPick,
}: {
  item: InboxItem;
  picked: "legit" | "phishing" | null;
  showExplain: boolean;
  onPick: (v: "legit" | "phishing") => void;
}) {
  const isCorrect = picked ? picked === item.verdict : false;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-widest text-white/60">
          {item.channel === "email" ? "Email" : "SMS"}
        </div>

        {showExplain && picked && (
          <div
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              isCorrect
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : "border-red-400/40 bg-red-400/10 text-red-200"
            )}
          >
            {isCorrect ? "✅ ถูก" : "❌ ผิด"}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="text-sm text-white/70">
          <span className="text-white/90">From:</span> {item.from}
        </div>
        {item.to ? (
          <div className="mt-1 text-sm text-white/70">
            <span className="text-white/90">To:</span> {item.to}
          </div>
        ) : null}
        {item.subject ? (
          <div className="mt-2 text-base font-semibold">{item.subject}</div>
        ) : null}

        <div className="mt-3 whitespace-pre-wrap text-sm text-white/85">
          {item.body}
        </div>

        {item.links?.length ? (
          <div className="mt-4 space-y-2">
            <div className="text-xs uppercase tracking-widest text-white/50">
              Links
            </div>
            {item.links.map((l, i) => (
              <div
                key={i}
                className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"
              >
                <div className="text-white/90">{l.text}</div>
                <div className="mt-1 break-all font-mono text-xs text-white/70">
                  {l.url}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {item.attachments?.length ? (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-widest text-white/50">
              Attachments
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.attachments.map((a) => (
                <span
                  key={a}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <motion.button
          onClick={() => onPick("legit")}
          disabled={showExplain}
          className={cn(
            "rounded-xl border px-4 py-3 text-left transition",
            "border-white/10 bg-black/30 hover:bg-white/10",
            picked === "legit" && !showExplain && "border-white/40 bg-white/10"
          )}
          whileTap={{ scale: 0.99 }}
        >
          <div className="font-semibold">✅ ของจริง (Legit)</div>
          <div className="mt-1 text-sm text-white/70">
            น่าเชื่อถือ / ปลอดภัย
          </div>
        </motion.button>

        <motion.button
          onClick={() => onPick("phishing")}
          disabled={showExplain}
          className={cn(
            "rounded-xl border px-4 py-3 text-left transition",
            "border-white/10 bg-black/30 hover:bg-white/10",
            picked === "phishing" && !showExplain && "border-white/40 bg-white/10"
          )}
          whileTap={{ scale: 0.99 }}
        >
          <div className="font-semibold">⚠️ หลอกลวง (Phishing)</div>
          <div className="mt-1 text-sm text-white/70">
            มีสัญญาณอันตราย / ต้องระวัง
          </div>
        </motion.button>
      </div>

      {showExplain && (
        <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold">เฉลย</div>
          <div className="mt-1 text-sm text-white/85">
            <span className="font-semibold">คำตอบที่ถูก:</span>{" "}
            {item.verdict === "legit" ? "ของจริง (Legit)" : "หลอกลวง (Phishing)"}
          </div>

          <div className="mt-3 text-sm text-white/80">
            <span className="font-semibold">เหตุผล:</span> {item.explanation}
          </div>

          {item.redFlags?.length ? (
            <>
              <div className="mt-4 text-sm font-semibold">Red Flags</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                {item.redFlags.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          ) : null}

          {item.safeActions?.length ? (
            <>
              <div className="mt-4 text-sm font-semibold">ควรทำอย่างไร</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                {item.safeActions.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
