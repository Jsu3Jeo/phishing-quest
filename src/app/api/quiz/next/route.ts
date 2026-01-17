import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { sha256, safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GenOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(2),
  explanation: z.string().min(3),
});

const GenQuizSchema = z.object({
  stem: z.string().min(10),
  options: z.array(GenOptionSchema).length(4),
  correctId: z.string().min(1),
  whyCorrect: z.string().min(5),
  signals: z.array(z.string()).min(2),
});

type GenQuiz = z.infer<typeof GenQuizSchema>;

export type QuizOut = {
  kind: "quiz";
  stem: string;
  options: { label: "A" | "B" | "C" | "D"; text: string; isCorrect: boolean; explanation: string }[];
  whyCorrect: string;
  signals: string[];
  hash: string;
  source?: "ai";
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

/** ✅ hash stable: ไม่ขึ้นกับลำดับตัวเลือก */
function hashQuiz(stem: string, optionTexts: string[]) {
  const stemN = normalizeText(stem).toLowerCase();
  const optsN = optionTexts.map((t) => normalizeText(t).toLowerCase()).sort();
  return sha256(stemN + "\n" + optsN.join("\n"));
}

/** ✅ similarity แบบ 3-gram (ใช้ได้กับภาษาไทย) */
function grams3(s: string) {
  const x = normalizeText(s)
    .toLowerCase()
    // ลบ URL ง่ายๆ เพื่อลด “คล้ายเพราะลิงก์”
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

  const hash = hashQuiz(gen.stem, options.map((o) => o.text));
  return {
    kind: "quiz",
    stem: gen.stem,
    options,
    whyCorrect: gen.whyCorrect,
    signals: gen.signals,
    hash,
    source: "ai",
  };
}

async function generateQuizAI(avoidSignals: string[], avoidStems: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const prompt = `
NONCE=${nonce}
สร้างโจทย์ฝึกจับ phishing แบบ "สถานการณ์" 1 ข้อ (ไทยเป็นหลัก แทรกอังกฤษได้เล็กน้อย)

สำคัญมาก:
- ต้อง "ใหม่" และ "ไม่คล้าย" รายการด้านล่าง (ห้ามใช้โครงเรื่อง/คำพูด/ธีมใกล้เคียง)
- ต้องมีรายละเอียดเฉพาะเจาะจง (แบรนด์/ช่องทาง/บริบท/เวลา/คำขู่/ข้อเสนอ) ที่ต่างจากเดิม
- สุ่มธีม: ธนาคาร/ขนส่ง/OTP/marketplace/streaming/work email/social/travel/telecom/gov
- ตัวเลือก 4 ข้อ “ต่างกันชัดเจน” และมีคำอธิบายสั้นๆรายข้อ
- correctId ต้องอ้างถึง option.id (o1/o2/o3/o4)
- signals อย่างน้อย 2

หลีกเลี่ยง stem ใกล้เคียง:
${avoidStems.slice(-40).map((s) => `- ${s}`).join("\n")}

หลีกเลี่ยง signals ซ้ำ:
${avoidSignals.slice(-30).map((s) => `- ${s}`).join("\n")}

ตอบเป็น JSON อย่างเดียว:
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
  const t = setTimeout(() => controller.abort(), 5500); // เร็ว + ไม่ค้าง

  try {
    const resp = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: "You output ONLY valid JSON. No markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" } as any,
        temperature: 0.8, // เพิ่มความหลากหลาย
        max_tokens: 650,
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

  const recentHashes: string[] = Array.isArray(body?.recentHashes)
    ? body.recentHashes.slice(0, 500).map(String).filter(Boolean)
    : [];

  const recentSignals: string[] = Array.isArray(body?.recentSignals)
    ? body.recentSignals.slice(0, 300).map(String).filter(Boolean)
    : [];

  const recentStems: string[] = Array.isArray(body?.recentStems)
    ? body.recentStems.slice(0, 300).map(String).filter(Boolean)
    : [];

  const recentStemGrams = recentStems.map((s) => grams3(s));
  const start = Date.now();
  const HARD_LIMIT_MS = 12_000;

  // ✅ fresh-only: ไม่อ่าน DB / ไม่ใช้ fallback bank
  // ✅ พยายามหลายรอบภายในเวลาจำกัด
  for (let attempt = 0; attempt < 10; attempt++) {
    if (Date.now() - start > HARD_LIMIT_MS) break;

    const q = await generateQuizAI(recentSignals, recentStems);
    if (!q) continue;

    if (recentHashes.includes(q.hash)) continue;

    // ✅ กัน “คล้าย” ด้วย 3-gram similarity
    const gNew = grams3(q.stem);
    let tooSimilar = false;
    for (const gOld of recentStemGrams) {
      if (jaccard(gNew, gOld) >= 0.62) {
        tooSimilar = true;
        break;
      }
    }
    if (tooSimilar) continue;

    return NextResponse.json({ quiz: q });
  }

  return NextResponse.json(
    { error: "AI สร้างโจทย์ใหม่ไม่สำเร็จ (กันซ้ำ/กันคล้ายเข้ม) กดลองใหม่อีกครั้ง" },
    { status: 503 }
  );
}
