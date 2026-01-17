import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { sha256, safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ItemSchema = z.object({
  channel: z.enum(["email", "sms"]),
  from: z.string().min(3),
  to: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(18),
  links: z.array(z.object({ text: z.string().min(1), url: z.string().min(5) })).default([]),
  attachments: z.array(z.string()).optional(),
  verdict: z.enum(["legit", "phishing"]),
  explanation: z.string().min(8),
  redFlags: z.array(z.string()).min(2).max(8),
  safeActions: z.array(z.string()).min(2).max(8),
});

export type ItemOut = z.infer<typeof ItemSchema> & {
  kind: "inbox";
  hash: string;
  source?: "ai";
};

function normalizeText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function normalizeUrl(u: string) {
  return normalizeText(u).replace(/\s+/g, "");
}

/** ✅ hash stable ไม่ขึ้นกับลำดับ links */
function hashItem(i: Omit<ItemOut, "hash" | "kind" | "source">) {
  const linksNorm = (i.links || [])
    .map((l) => `${normalizeText(l.text)}|${normalizeUrl(l.url)}`)
    .sort();

  const base =
    `${normalizeText(i.channel)}\n` +
    `${normalizeText(i.from)}\n` +
    `${normalizeText(i.to ?? "")}\n` +
    `${normalizeText(i.subject ?? "")}\n` +
    `${normalizeText(i.body)}\n` +
    linksNorm.join("\n");

  return sha256(base.toLowerCase());
}

function grams3(s: string) {
  const x = normalizeText(s)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const set = new Set<string>();
  if (x.length < 3) {
    if (x) set.add(x);
    return set;
  }
  for (let i = 0; i <= x.length - 3; i++) set.add(x.slice(i, i + 3));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
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

async function generateInboxAI(avoidHints: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const prompt = `
NONCE=${nonce}
สร้าง "อีเมลหรือ SMS" 1 ชิ้น สำหรับฝึกจับ phishing (ไทยเป็นหลัก) ให้สมจริง

สำคัญมาก:
- ต้อง "ใหม่" และ "ไม่คล้าย" สิ่งที่เคยมีด้านล่าง (ห้ามใช้โครงเรื่อง/วลี/ธีมใกล้เคียง)
- ใส่รายละเอียดเฉพาะเจาะจง (บริบท/เวลา/ชื่อบริการ/คำขู่/ข้อเสนอ) ที่ต่างจากเดิม
- ตอบเป็น JSON อย่างเดียว
- verdict สุ่มได้ทั้ง "legit" หรือ "phishing"
- ต้องมี explanation, redFlags>=2, safeActions>=2

หลีกเลี่ยงซ้ำ/คล้ายกับ:
${avoidHints.slice(-40).map((x) => `- ${x}`).join("\n")}

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
  const t = setTimeout(() => controller.abort(), 5200);

  try {
    const resp = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: "Return ONLY valid JSON. No markdown. No extra text." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" } as any,
        temperature: 0.85,
        max_tokens: 650,
      } as any,
      { signal: controller.signal } as any
    );

    const text = resp.choices[0]?.message?.content?.trim() || "";
    const parsed = parseItem(text);
    if (!parsed) return null;

    const hash = hashItem(parsed as any);
    const out: ItemOut = { kind: "inbox", ...(parsed as any), hash, source: "ai" };
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
    ? body.recentHashes.slice(0, 600).map(String).filter(Boolean)
    : [];

  // ✅ รับ “ข้อความล่าสุด” จาก client เพื่อกันคล้าย
  const recentTexts: string[] = Array.isArray(body?.recentTexts)
    ? body.recentTexts.slice(0, 200).map(String).filter(Boolean)
    : [];

  const avoid = [
    ...recentHashes.map((h) => `hash:${h.slice(0, 10)}`),
    ...recentTexts.slice(-40),
    "ธนาคาร",
    "พัสดุ",
    "OTP",
    "บัญชี",
    "ชำระเงิน",
  ];

  const recentTextGrams = recentTexts.map((t) => grams3(t));
  const start = Date.now();
  const HARD_LIMIT_MS = 12_000;

  for (let attempt = 0; attempt < 12; attempt++) {
    if (Date.now() - start > HARD_LIMIT_MS) break;

    const item = await generateInboxAI(avoid);
    if (!item) continue;

    if (recentHashes.includes(item.hash)) continue;

    // ✅ กัน “คล้าย” ด้วย 3-gram จาก subject+body
    const pack = `${item.subject ?? ""}\n${item.body}`;
    const gNew = grams3(pack);
    let tooSimilar = false;
    for (const gOld of recentTextGrams) {
      if (jaccard(gNew, gOld) >= 0.62) {
        tooSimilar = true;
        break;
      }
    }
    if (tooSimilar) continue;

    return NextResponse.json({ item });
  }

  return NextResponse.json(
    { error: "AI สร้างข้อความใหม่ไม่สำเร็จ (กันซ้ำ/กันคล้ายเข้ม) กดลองใหม่อีกครั้ง" },
    { status: 503 }
  );
}
