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
  explanation: z.string().min(6), // ผ่อนนิดนึง กัน fail ง่าย
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

  const quizNoHash = {
    stem: gen.stem,
    options,
    whyCorrect: gen.whyCorrect,
    signals: gen.signals,
  };

  const hash = hashQuiz({ stem: quizNoHash.stem, options: quizNoHash.options });
  return { ...quizNoHash, hash };
}

// ✅ cache: กันซ้ำด้วย hash เป็นหลัก (เด็ดขาด)
async function getCachedQuiz(recentHashes: string[], recentStems: string[]) {
  try {
    // ดึงเยอะขึ้น และเรียงใหม่ก่อน เพื่อไม่วนแต่ของเก่า
    const rows = await prisma.question.findMany({
      take: 600,
      orderBy: { createdAt: "desc" },
      select: { contentJson: true },
    });

    const candidates: any[] = [];
    for (const r of rows) {
      try {
        const obj = JSON.parse(r.contentJson || "{}");
        if (obj?.kind !== "quiz") continue;
        if (!obj?.hash || !obj?.stem || !obj?.options) continue;
        candidates.push(obj);
      } catch {}
    }

    // ✅ ห้ามซ้ำ hash ใน session เด็ดขาด
    const filtered = candidates.filter((q) => {
      const h = String(q.hash || "");
      if (!h) return false;
      if (recentHashes.includes(h)) return false;

      // กันซ้ำ stem แบบเสริม (เผื่อ hash ไม่ส่งมาบางเคส)
      const stem = String(q.stem || "");
      if (stem && recentStems.includes(stem)) return false;

      return true;
    });

    const pool = filtered.length > 0 ? filtered : [];
    if (pool.length === 0) return null;

    // ✅ สุ่มจาก top ช่วงล่าสุด เพื่อกระจาย
    const top = pool.slice(0, Math.min(pool.length, 250));
    return top[Math.floor(Math.random() * top.length)];
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

เงื่อนไขสำคัญ:
- ห้ามใช้เทมเพลตเดิมซ้ำ (อย่าเขียนรูปแบบเดิมวน)
- สุ่มธีมให้หลากหลาย: ธนาคาร, ขนส่งพัสดุ, social, work email, OTP, marketplace, streaming, travel, gov, telecom แบบสุ่มๆ
- 4 ตัวเลือกต้องต่างกันมาก (ห้ามคำตอบคล้ายกัน)
- explanation สั้นแต่ชัดรายข้อ
- correctId ต้องอ้างถึง option.id (o1/o2/o3/o4)
- signals อย่างน้อย 2

หลีกเลี่ยง stem ที่คล้ายของเดิม:
${avoidStems.map((s) => `- ${s}`).join("\n")}

หลีกเลี่ยง signals ซ้ำเยอะ:
${avoidSignals.map((s) => `- ${s}`).join("\n")}

ตอบเป็น JSON เท่านั้น ห้าม markdown/ข้อความอื่น

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

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000); // ✅ เพิ่มเวลาให้ Vercel/Neon ไม่ fail ง่าย

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

  // ✅ รับ recentHashes จาก client เพื่อกันซ้ำแบบเด็ดขาด
  const recentHashes: string[] = Array.isArray(body?.recentHashes)
    ? body.recentHashes.slice(0, 80).map(String).filter(Boolean)
    : [];

  const recentSignals: string[] = Array.isArray(body?.recentSignals)
    ? body.recentSignals.slice(0, 40).map(String).filter(Boolean)
    : [];

  const recentStems: string[] = Array.isArray(body?.recentStems)
    ? body.recentStems.slice(0, 30).map(String).filter(Boolean)
    : [];

  // ✅ FAST PATH: DB cache ก่อน (ห้ามซ้ำ hash)
  const cached = await getCachedQuiz(recentHashes, recentStems);
  if (cached) return NextResponse.json({ quiz: cached });

  // ✅ ถ้าไม่มี cache เลย ค่อยยิง AI แล้วบันทึกลง DB
  for (let attempt = 0; attempt < 10; attempt++) {
    const q = await generateQuiz(recentSignals.slice(-20), recentStems.slice(-20));
    if (!q) continue;

    // ห้ามซ้ำกับ session ของผู้เล่น
    if (recentHashes.includes(q.hash)) continue;

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

  // ✅ ไม่ยอมซ้ำ: ถ้าหาไม่ได้จริง ๆ ให้ error ไปเลย (ตามที่คุณต้องการ “ไม่ซ้ำเลย”)
  return NextResponse.json({ error: "AI สร้างโจทย์ไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 503 });
}
