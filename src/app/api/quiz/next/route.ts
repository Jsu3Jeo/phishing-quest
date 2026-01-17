import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { sha256, safeJsonParse } from "@/lib/utils";

const GenOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(2),
  explanation: z.string().min(3), // ✅ ผ่อนอีกนิด กัน fail
});

const GenQuizSchema = z.object({
  stem: z.string().min(8), // ✅ ผ่อนอีกนิด กัน fail
  options: z.array(GenOptionSchema).length(4),
  correctId: z.string().min(1),
  whyCorrect: z.string().min(5),
  signals: z.array(z.string()).min(2).max(6),
});

type GenQuiz = z.infer<typeof GenQuizSchema>;

type QuizOut = {
  kind: "quiz";
  stem: string;
  options: { label: "A" | "B" | "C" | "D"; text: string; isCorrect: boolean; explanation: string }[];
  whyCorrect: string;
  signals: string[];
  hash: string;
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function hashQuiz(q: { stem: string; options: { text: string }[] }) {
  const base = normalizeText(q.stem) + "\n" + q.options.map((o) => normalizeText(o.text)).join("\n");
  return sha256(base);
}

function extractLikelyJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function parseGenQuiz(text: string): GenQuiz | null {
  const p1 = safeJsonParse<unknown>(text);
  if (p1.ok) {
    const z1 = GenQuizSchema.safeParse(p1.data);
    if (z1.success) return z1.data;
  }

  const cut = extractLikelyJson(text);
  if (cut) {
    const p2 = safeJsonParse<unknown>(cut);
    if (p2.ok) {
      const z2 = GenQuizSchema.safeParse(p2.data);
      if (z2.success) return z2.data;
    }
  }

  return null;
}

function buildQuizOut(gen: GenQuiz): QuizOut | null {
  const optionTexts = gen.options.map((o) => normalizeText(o.text).toLowerCase());
  if (new Set(optionTexts).size < 4) return null;

  if (!gen.options.some((o) => o.id === gen.correctId)) return null;

  const shuffled = shuffle(gen.options);
  const labels = ["A", "B", "C", "D"] as const;

  const options = shuffled.map((o, idx) => ({
    label: labels[idx],
    text: o.text,
    explanation: o.explanation,
    isCorrect: o.id === gen.correctId,
  }));

  if (options.filter((o) => o.isCorrect).length !== 1) return null;

  const hash = hashQuiz({ stem: gen.stem, options });
  return {
    kind: "quiz",
    stem: gen.stem,
    options,
    whyCorrect: gen.whyCorrect,
    signals: gen.signals,
    hash,
  };
}

async function generateQuizFast(avoidSignals: string[], avoidStems: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const themes = [
    "ธนาคาร/บัตรเครดิต",
    "ขนส่งพัสดุ/ค่าส่ง",
    "Social/บัญชีล็อก",
    "Work email/เอกสาร",
    "OTP/รหัสยืนยัน",
    "Marketplace/ซื้อขาย",
    "Streaming/ต่ออายุ",
    "Travel/โรงแรม/ตั๋ว",
    "Government/ภาษี/กรม",
    "Telecom/แพ็กเน็ต",
  ];
  const theme = themes[Math.floor(Math.random() * themes.length)];

  const prompt = `
NONCE=${nonce}
ออกโจทย์ฝึกจับ phishing แบบสถานการณ์ 1 ข้อ (ไทยเป็นหลัก) ธีม: ${theme}

ข้อกำหนด:
- ตอบเป็น JSON อย่างเดียว
- 4 ตัวเลือกต้องต่างกันชัดเจน
- correctId ต้องเป็น o1/o2/o3/o4 ที่มีอยู่จริง
- หลีกเลี่ยง stem ซ้ำ:
${avoidStems.slice(-20).map((s) => `- ${s}`).join("\n")}
- หลีกเลี่ยง signals ซ้ำ:
${avoidSignals.slice(-20).map((s) => `- ${s}`).join("\n")}

JSON:
{
  "stem": "...",
  "options": [
    {"id":"o1","text":"...","explanation":"..."},
    {"id":"o2","text":"...","explanation":"..."},
    {"id":"o3","text":"...","explanation":"..."},
    {"id":"o4","text":"...","explanation":"..."}
  ],
  "correctId": "o2",
  "whyCorrect": "...",
  "signals": ["...", "..."]
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
        // ✅ บังคับ JSON (ช่วยลด parse fail มาก)
        response_format: { type: "json_object" } as any,
        temperature: 0.65,
        max_tokens: 650, // ✅ เร็วขึ้น
      } as any,
      { signal: controller.signal } as any
    );

    const text = resp.choices[0]?.message?.content?.trim() || "";
    const gen = parseGenQuiz(text);
    if (!gen) return null;

    return buildQuizOut(gen);
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

  const recentSignals: string[] = Array.isArray(body?.recentSignals)
    ? body.recentSignals.slice(0, 60).map(String).filter(Boolean)
    : [];

  const recentStems: string[] = Array.isArray(body?.recentStems)
    ? body.recentStems.slice(0, 80).map(String).filter(Boolean)
    : [];

  // ✅ ไม่อ่าน DB เก่าแล้ว: “สร้างใหม่เท่านั้น”
  for (let attempt = 0; attempt < 8; attempt++) {
    const q = await generateQuizFast(recentSignals, recentStems);
    if (!q) continue;

    // ✅ กันซ้ำใน session แบบเด็ดขาด
    if (recentHashes.includes(q.hash)) continue;

    // ✅ กันซ้ำกับ DB เฉพาะตอนบันทึก
    const exists = await prisma.question.findUnique({ where: { hash: q.hash } });
    if (exists) continue;

    // ✅ บันทึก (แต่ไม่เอามา cache)
    await prisma.question.create({
      data: { hash: q.hash, contentJson: JSON.stringify(q) },
    });

    return NextResponse.json({ quiz: q });
  }

  return NextResponse.json({ error: "AI สร้างโจทย์ไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });
}
