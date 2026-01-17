import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { sha256, safeJsonParse } from "@/lib/utils";

const ItemSchema = z.object({
  channel: z.enum(["email", "sms"]),
  from: z.string().min(3),
  to: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(18),
  links: z.array(z.object({ text: z.string().min(1), url: z.string().min(5) })).default([]),
  attachments: z.array(z.string()).optional(),
  verdict: z.enum(["legit", "phishing"]),
  explanation: z.string().min(10),
  redFlags: z.array(z.string()).min(2).max(8),
  safeActions: z.array(z.string()).min(2).max(8),
});

type Verdict = "legit" | "phishing";
type ItemOut = z.infer<typeof ItemSchema> & { kind: "inbox"; hash: string };

function hashItem(i: Omit<ItemOut, "hash" | "kind">) {
  const base =
    `${i.channel}\n${i.from}\n${i.to ?? ""}\n${i.subject ?? ""}\n${i.body}\n` +
    (i.links || []).map((l) => `${l.text}|${l.url}`).join("\n");
  return sha256(base);
}

function extractLikelyJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function parseItem(text: string) {
  const p1 = safeJsonParse<unknown>(text);
  if (p1.ok) {
    const z1 = ItemSchema.safeParse(p1.data);
    if (z1.success) return z1.data;
  }
  const cut = extractLikelyJson(text);
  if (cut) {
    const p2 = safeJsonParse<unknown>(cut);
    if (p2.ok) {
      const z2 = ItemSchema.safeParse(p2.data);
      if (z2.success) return z2.data;
    }
  }
  return null;
}

async function generateInboxFast(avoidHints: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const prompt = `
NONCE=${nonce}
สร้าง "อีเมลหรือ SMS" 1 ชิ้น สำหรับฝึกจับ phishing (ไทยเป็นหลัก) ให้สมจริง

ข้อกำหนด:
- ตอบเป็น JSON อย่างเดียว
- verdict สุ่มได้ทั้ง "legit" หรือ "phishing" (ไม่ต้องบังคับ)
- ต้องมี explanation, redFlags>=2, safeActions>=2
- หลีกเลี่ยงซ้ำ/คล้ายกับ: ${avoidHints.slice(0, 25).join(" | ")}

JSON:
{
  "channel": "email|sms",
  "from": "...",
  "to": "... (optional)",
  "subject": "... (optional)",
  "body": "....",
  "links": [{"text":"...","url":"..."}],
  "attachments": ["..."] (optional),
  "verdict": "legit|phishing",
  "explanation": "...",
  "redFlags": ["...", "..."],
  "safeActions": ["...", "..."]
}
`.trim();

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    const resp = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: "Return ONLY valid JSON. No markdown. No extra text." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" } as any,
        temperature: 0.75,
        max_tokens: 650,
      } as any,
      { signal: controller.signal } as any
    );

    const text = resp.choices[0]?.message?.content?.trim() || "";
    const parsed = parseItem(text);
    if (!parsed) return null;

    const hash = hashItem(parsed as any);
    const out: ItemOut = { kind: "inbox", ...(parsed as any), hash };
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);

  const recentHashes: string[] = Array.isArray(body?.recentHashes)
    ? body.recentHashes.slice(0, 120).map(String).filter(Boolean)
    : [];

  const avoid = [
    ...recentHashes.map((h) => `hash:${h.slice(0, 10)}`),
    "ธนาคาร",
    "พัสดุ",
    "OTP",
    "บัญชี",
    "ชำระเงิน",
  ];

  // ✅ ไม่อ่าน DB เก่าแล้ว: “สร้างใหม่เท่านั้น”
  for (let attempt = 0; attempt < 8; attempt++) {
    const item = await generateInboxFast(avoid);
    if (!item) continue;

    if (recentHashes.includes(item.hash)) continue;

    const exists = await prisma.question.findUnique({ where: { hash: item.hash } });
    if (exists) continue;

    await prisma.question.create({
      data: { hash: item.hash, contentJson: JSON.stringify(item) },
    });

    return NextResponse.json({ item });
  }

  return NextResponse.json({ error: "AI สร้างข้อความไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });
}
