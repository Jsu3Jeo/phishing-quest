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
  body: z.string().min(12),
  links: z.array(z.object({ text: z.string().min(1), url: z.string().min(5) })).default([]),
  attachments: z.array(z.string()).optional(),
  verdict: z.enum(["legit", "phishing"]),
  explanation: z.string().min(10),
  redFlags: z.array(z.string()).min(2),
  safeActions: z.array(z.string()).min(2),
});

type Verdict = "legit" | "phishing";
type Item = z.infer<typeof ItemSchema> & { hash: string };

function hashItem(i: Omit<Item, "hash">) {
  const base =
    `${i.channel}\n${i.from}\n${i.to ?? ""}\n${i.subject ?? ""}\n${i.body}\n` +
    (i.links || []).map((l) => `${l.text}|${l.url}`).join("\n");
  return sha256(base);
}

/**
 * ✅ สุ่มจริง + ยังบาลานซ์ในช่วงล่าสุด
 * - ถ้าช่วงล่าสุด (window) ฝั่งใดมากกว่าอีกฝั่ง >=2 -> ดันไปฝั่งที่น้อย
 * - ถ้าไม่ต่างกัน -> สุ่ม 50/50
 * - กัน pattern สลับเป๊ะ L,P,L,P ด้วยการไม่ "กลับด้านจากอันล่าสุด" แบบเดิม
 */
function pickDesiredVerdict(recentVerdicts: Verdict[]) {
  const windowSize = 8;
  const window = recentVerdicts.slice(-windowSize);

  const legitCount = window.filter((v) => v === "legit").length;
  const phishingCount = window.filter((v) => v === "phishing").length;

  // ดันฝั่งที่น้อย ถ้าเริ่มเอียง
  if (legitCount - phishingCount >= 2) return "phishing";
  if (phishingCount - legitCount >= 2) return "legit";

  // ปกติ: สุ่มจริง
  return Math.random() < 0.5 ? "legit" : "phishing";
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

async function getCachedInboxItem(recentHashes: string[], desired: Verdict) {
  try {
    const rows = await prisma.question.findMany({
      take: 1200,
      orderBy: { createdAt: "desc" },
      select: { contentJson: true },
    });

    const candidates: any[] = [];

    for (const r of rows) {
      try {
        const obj = JSON.parse(r.contentJson || "{}");
        if (obj?.kind !== "inbox") continue;
        if (!obj?.hash) continue;
        if (recentHashes.includes(String(obj.hash))) continue;
        if (obj?.verdict !== "legit" && obj?.verdict !== "phishing") continue;
        candidates.push(obj);
      } catch {}
    }

    if (candidates.length === 0) return null;

    // 60% prefer desired ถ้ามี, 40% สุ่มรวม
    const preferDesired = Math.random() < 0.6;
    if (preferDesired) {
      const desiredPool = candidates.filter((x) => x?.verdict === desired);
      if (desiredPool.length > 0) {
        const top = desiredPool.slice(0, Math.min(desiredPool.length, 250));
        return top[Math.floor(Math.random() * top.length)];
      }
    }

    const top = candidates.slice(0, Math.min(candidates.length, 250));
    return top[Math.floor(Math.random() * top.length)];
  } catch {
    return null;
  }
}

async function generateItem(avoid: string[], desired: Verdict) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt = `
สร้าง "อีเมลหรือ SMS ตัวอย่าง" 1 ชิ้น สำหรับฝึกจับ phishing
ต้องดูสมจริงเหมือนที่คนไทยเจอจริง (ภาษาไทยเป็นหลัก แทรกอังกฤษได้)
ผู้เล่นต้องตอบว่า: legit หรือ phishing

กำหนด verdict รอบนี้ให้เป็น: ${desired}
(ต้องเป็น "${desired}" เท่านั้น)

เงื่อนไข:
- สมจริง: ชื่อผู้ส่ง/หัวข้อ/เนื้อหา/ลิงก์เหมือนโลกจริง
- ถ้า phishing: มี red flags ที่พอคิดแล้วใช่ ไม่หลอกง่ายเกินไป
- ถ้า legit: น่าเชื่อ แต่มีจุดให้ลังเลนิด ๆ เพื่อให้เกมสนุก
- ตอบเป็น JSON อย่างเดียว ห้ามมี markdown
- หลีกเลี่ยงซ้ำกับ: ${avoid.join(" | ")}

JSON:
{
  "channel": "email|sms",
  "from": "...",
  "to": "... (optional)",
  "subject": "... (optional)",
  "body": "เนื้อความ",
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
          { role: "system", content: "You output ONLY valid JSON. No markdown." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      },
      { signal: controller.signal } as any
    );

    const text = resp.choices[0]?.message?.content?.trim() || "";
    const parsed = parseItem(text);
    if (!parsed) return null;

    // บังคับตาม desired (กัน AI หลุด)
    if (parsed.verdict !== desired) return null;

    const hash = hashItem(parsed);
    return { ...parsed, hash };
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

  const recentHashes: string[] = Array.isArray(body?.recentHashes) ? body.recentHashes.slice(0, 30).map(String) : [];

  const recentVerdicts: Verdict[] = Array.isArray(body?.recentVerdicts)
    ? body.recentVerdicts
        .map((v: any) => (v === "legit" ? "legit" : v === "phishing" ? "phishing" : null))
        .filter(Boolean)
    : [];

  const desired = pickDesiredVerdict(recentVerdicts);

  // ✅ FAST PATH: DB cache ก่อน
  const cached = await getCachedInboxItem(recentHashes, desired);
  if (cached) return NextResponse.json({ item: cached });

  const avoid = [...recentHashes.map((h) => `hash:${h.slice(0, 10)}`), "ภาษาไทยเป็นหลัก", "ดูสมจริง"];

  for (let attempt = 0; attempt < 6; attempt++) {
    const item = await generateItem(avoid, desired);
    if (!item) continue;

    if (recentHashes.includes(item.hash)) continue;

    const exists = await prisma.question.findUnique({ where: { hash: item.hash } });
    if (exists) continue;

    await prisma.question.create({
      data: {
        hash: item.hash,
        contentJson: JSON.stringify({ kind: "inbox", ...item }),
      },
    });

    return NextResponse.json({ item: { kind: "inbox", ...item } });
  }

  return NextResponse.json({ error: "AI สร้างข้อความไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });
}
