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
  explanation: z.string().min(6), // ✅ ผ่อนนิดนึง กัน fail ง่าย
});

const GenQuizSchema = z.object({
  stem: z.string().min(12),
  options: z.array(GenOptionSchema).length(4),
  correctId: z.string().min(1),
  whyCorrect: z.string().min(8),
  signals: z.array(z.string()).min(2),
});

type GenQuiz = z.infer<typeof GenQuizSchema>;

type QuizOut = {
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

function parseGenQuiz(text: string) {
  // 1) ตรง ๆ
  const p1 = safeJsonParse<unknown>(text);
  if (p1.ok) {
    const z1 = GenQuizSchema.safeParse(p1.data);
    if (z1.success) return z1.data;
  }

  // 2) salvage JSON ช่วง {...}
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
  // กัน option ซ้ำ
  const optionTexts = gen.options.map((o) => normalizeText(o.text).toLowerCase());
  if (new Set(optionTexts).size < 4) return null;

  // correctId ต้องอยู่จริง
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

  const quizNoHash = {
    stem: gen.stem,
    options,
    whyCorrect: gen.whyCorrect,
    signals: gen.signals,
  };

  const hash = hashQuiz({ stem: quizNoHash.stem, options: quizNoHash.options });
  return { ...quizNoHash, hash };
}

async function getCachedQuiz(recentStems: string[]) {
  try {
    const rows = await prisma.question.findMany({ take: 80 });
    const candidates: any[] = [];

    for (const r of rows) {
      try {
        const obj = JSON.parse(r.contentJson || "{}");
        if (obj?.kind !== "quiz") continue;
        if (!obj?.stem || !obj?.options) continue;
        candidates.push(obj);
      } catch {}
    }

    const filtered = candidates.filter((q) => {
      const stem = String(q.stem || "");
      return !recentStems.includes(stem);
    });

    const pool = filtered.length > 0 ? filtered : candidates; // ถ้าไม่มีจริง ๆ ก็ยอมซ้ำเพื่อให้เกมไม่ค้าง
    if (pool.length === 0) return null;

    return pool[Math.floor(Math.random() * pool.length)];
  } catch {
    return null;
  }
}

async function generateQuiz(avoidSignals: string[], avoidStems: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const prompt = `
NONCE=${nonce}
คุณคือครูสอน cybersecurity ออกโจทย์ฝึกจับ phishing แบบ "สถานการณ์" 1 ข้อ

เงื่อนไขกันซ้ำ (สำคัญมาก):
- ห้ามใช้ประโยค/รูปแบบ/เทมเพลตเดิมซ้ำ
- หัวข้อให้สุ่มจากหลายธีม: ธนาคาร, ขนส่งพัสดุ, social, work email, OTP, marketplace, streaming, travel, gov, telecom
- หลีกเลี่ยง stem ที่คล้ายของเดิม: 
${avoidStems.map((s) => `- ${s}`).join("\n")}

ต้องได้ 4 ตัวเลือกที่ต่างกันมาก (ห้ามคำตอบคล้ายกัน)
ตอบเป็น JSON เท่านั้น ห้าม markdown

รูปแบบ JSON:
{
  "stem": "คำถาม...",
  "options": [
    {"id":"o1","text":"...","explanation":"..."},
    {"id":"o2","text":"...","explanation":"..."},
    {"id":"o3","text":"...","explanation":"..."},
    {"id":"o4","text":"...","explanation":"..."}
  ],
  "correctId": "o2",
  "whyCorrect": "สรุปว่าทำไมคำตอบนี้ถูกที่สุด",
  "signals": ["สัญญาณเตือน 1", "สัญญาณเตือน 2"]
}
`.trim();

  // ✅ timeout กันค้าง
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
        temperature: 0.65, // ✅ ลดเพื่อให้ JSON ตรงขึ้น
      },
      { signal: controller.signal } as any
    );

    const text = resp.choices[0]?.message?.content?.trim() || "";
    const gen = parseGenQuiz(text);
    if (!gen) return null;

    const out = buildQuizOut(gen);
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

  const recentSignals: string[] = Array.isArray(body?.recentSignals) ? body.recentSignals.slice(0, 30).map(String) : [];
  const recentStems: string[] = Array.isArray(body?.recentStems) ? body.recentStems.slice(0, 15).map(String) : [];

  // ✅ FAST PATH: DB cache ก่อน
  const cached = await getCachedQuiz(recentStems);
  if (cached) return NextResponse.json({ quiz: cached });

  // ✅ ถ้าไม่มี cache เลย ค่อยยิง AI
  for (let attempt = 0; attempt < 6; attempt++) {
    const q = await generateQuiz(recentSignals.slice(-12), recentStems.slice(-8));
    if (!q) continue;

    const exists = await prisma.question.findUnique({ where: { hash: q.hash } });
    if (exists) continue;

    await prisma.question.create({
      data: {
        hash: q.hash,
        contentJson: JSON.stringify({ kind: "quiz", ...q }),
      },
    });

    return NextResponse.json({ quiz: { kind: "quiz", ...q } });
  }

  return NextResponse.json({ error: "AI สร้างโจทย์ไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });
}
