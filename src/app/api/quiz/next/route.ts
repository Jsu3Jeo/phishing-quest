import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { openai } from "@/lib/openai";
import { sha256, safeJsonParse } from "@/lib/utils";

// ✅ กัน Edge runtime แปลกๆ + กัน static prerender
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GenOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(2),
  explanation: z.string().min(4), // ผ่อนอีกนิด กัน fail ง่าย
});

const GenQuizSchema = z.object({
  stem: z.string().min(10),
  options: z.array(GenOptionSchema).length(4),
  correctId: z.string().min(1),
  whyCorrect: z.string().min(6),
  signals: z.array(z.string()).min(2),
});

type GenQuiz = z.infer<typeof GenQuizSchema>;

type QuizOut = {
  kind: "quiz";
  stem: string;
  options: { label: "A" | "B" | "C" | "D"; text: string; isCorrect: boolean; explanation: string }[];
  whyCorrect: string;
  signals: string[];
  hash: string;
  source?: "ai" | "fallback" | "db";
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

function hashQuiz(stem: string, optionTexts: string[]) {
  const base = normalizeText(stem) + "\n" + optionTexts.map(normalizeText).join("\n");
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

// ✅ Fallback: ไม่พึ่ง AI/DB (กันค้าง 503) — โจทย์มา “ทันที”
function fallbackQuiz(recentHashes: string[]): QuizOut {
  const bank = [
    {
      stem: "คุณได้รับ SMS แจ้งว่า “พัสดุติดศุลกากร ให้ชำระ 9 บาทภายใน 30 นาที” พร้อมลิงก์ย่อ คุณควรทำอย่างไรดีที่สุด?",
      correct: "เปิดเว็บ/แอปขนส่งทางการเอง ตรวจเลขพัสดุ และอย่ากดลิงก์จาก SMS",
      wrong: [
        "กดลิงก์แล้วจ่ายทันทีเพราะจำนวนเงินน้อย",
        "ส่งต่อ SMS ให้เพื่อนช่วยเช็คให้",
        "ตอบกลับข้อความเพื่อขอรายละเอียดเพิ่มเติม",
      ],
      signals: ["ลิงก์ย่อ/ไม่ใช่โดเมนทางการ", "เร่งด่วนให้ทำภายในเวลา", "เรียกชำระเงินเล็กน้อยเพื่อหลอกให้ชิน"],
      why: "วิธีที่ปลอดภัยคือเข้าแอป/เว็บทางการด้วยตัวเอง ไม่คลิกลิงก์ในข้อความเร่งด่วน",
    },
    {
      stem: "มีอีเมลจาก “IT Support” ขอให้คุณล็อกอินเพื่ออัปเดตรหัสผ่าน โดยให้กดปุ่ม Login ในอีเมล คุณควรตรวจอะไรเป็นอันดับแรก?",
      correct: "ตรวจโดเมนผู้ส่ง/ลิงก์จริง (hover) ว่าเป็นโดเมนองค์กรจริงหรือไม่",
      wrong: [
        "ดูแค่ว่ามีโลโก้บริษัทหรือไม่",
        "ดูว่าเขียนภาษาไทยถูกต้องหรือเปล่า",
        "รีบทำตามเพราะกลัวโดนล็อกบัญชี",
      ],
      signals: ["ขอให้ล็อกอินผ่านลิงก์ในอีเมล", "ขู่ให้รีบทำ", "ปลอมเป็นฝ่าย IT"],
      why: "การตรวจโดเมน/ลิงก์จริงช่วยจับการปลอมหน้าเว็บได้ดีที่สุดก่อนทำอะไรต่อ",
    },
    {
      stem: "คุณได้รับข้อความในโซเชียลว่า “คุณถูกรางวัล” พร้อมไฟล์แนบ .zip และบอกให้เปิดเพื่อรับสิทธิ์ คุณควรทำอย่างไร?",
      correct: "ไม่เปิดไฟล์แนบ และรายงาน/บล็อกบัญชีผู้ส่ง",
      wrong: [
        "เปิดไฟล์ก่อน แล้วค่อยสแกนไวรัสทีหลัง",
        "ส่งไฟล์ไปให้อีกคนลองเปิดแทน",
        "แตกไฟล์เฉพาะในมือถือจะปลอดภัยกว่า",
      ],
      signals: ["ไฟล์แนบ .zip จากแหล่งไม่รู้จัก", "ล่อด้วยของฟรี/รางวัล", "ชวนให้เปิดไฟล์ทันที"],
      why: "ไฟล์แนบจากแหล่งไม่รู้จักเสี่ยงมัลแวร์สูง ทางที่ถูกคือไม่เปิดและรายงาน",
    },
  ];

  // สุ่ม + กันซ้ำด้วย hash (ถ้าซ้ำก็วนหาใหม่)
  for (let i = 0; i < 6; i++) {
    const pick = bank[Math.floor(Math.random() * bank.length)];
    const correctIndex = Math.floor(Math.random() * 4);

    const choices = new Array(4).fill(null);
    choices[correctIndex] = pick.correct;

    const wrongs = shuffle(pick.wrong);
    let wi = 0;
    for (let k = 0; k < 4; k++) {
      if (choices[k]) continue;
      choices[k] = wrongs[wi++];
    }

    const labels = ["A", "B", "C", "D"] as const;
    const options = choices.map((text, idx) => ({
      label: labels[idx],
      text,
      isCorrect: idx === correctIndex,
      explanation:
        idx === correctIndex
          ? "เป็นการป้องกันที่ถูกต้องและลดความเสี่ยงโดนหลอก/โดนฝังมัลแวร์"
          : "เสี่ยงโดนหลอกหรือโดนขโมยข้อมูล ควรเลือกแนวทางที่ตรวจสอบผ่านช่องทางทางการ",
    }));

    const hash = hashQuiz(pick.stem, choices);
    if (recentHashes.includes(hash)) continue;

    return {
      kind: "quiz",
      stem: pick.stem,
      options,
      whyCorrect: pick.why,
      signals: pick.signals,
      hash,
      source: "fallback",
    };
  }

  // กันสุดท้าย (แทบไม่เกิด)
  const pick = bank[0];
  const hash = hashQuiz(pick.stem, [pick.correct, ...pick.wrong]);
  return {
    kind: "quiz",
    stem: pick.stem,
    options: [
      { label: "A", text: pick.correct, isCorrect: true, explanation: "ถูกต้องและปลอดภัยที่สุด" },
      { label: "B", text: pick.wrong[0], isCorrect: false, explanation: "เสี่ยงและไม่ควรทำ" },
      { label: "C", text: pick.wrong[1], isCorrect: false, explanation: "เสี่ยงและไม่ควรทำ" },
      { label: "D", text: pick.wrong[2], isCorrect: false, explanation: "เสี่ยงและไม่ควรทำ" },
    ],
    whyCorrect: pick.why,
    signals: pick.signals,
    hash,
    source: "fallback",
  };
}

// ✅ ใช้ DB เฉพาะถ้า “ไม่สั่ง freshOnly”
async function getCachedQuiz(recentHashes: string[]) {
  try {
    const rows = await prisma.question.findMany({
      take: 300,
      orderBy: { createdAt: "desc" },
      select: { contentJson: true },
    });

    const candidates: QuizOut[] = [];
    for (const r of rows) {
      try {
        const obj = JSON.parse(r.contentJson || "{}");
        if (obj?.kind !== "quiz") continue;
        if (!obj?.hash) continue;
        candidates.push(obj);
      } catch {}
    }

    const filtered = candidates.filter((q) => !recentHashes.includes(String(q.hash)));
    if (filtered.length === 0) return null;

    const top = filtered.slice(0, Math.min(filtered.length, 120));
    const picked = top[Math.floor(Math.random() * top.length)];
    return { ...picked, source: "db" as const };
  } catch {
    return null;
  }
}

async function generateQuizAI(avoidSignals: string[], avoidStems: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const prompt = `
NONCE=${nonce}
ออกโจทย์ฝึกจับ phishing แบบ "สถานการณ์" 1 ข้อ (ภาษาไทยเป็นหลัก แทรกอังกฤษได้เล็กน้อย)

เงื่อนไข:
- ห้ามใช้เทมเพลตเดิมซ้ำ
- สุ่มธีม: ธนาคาร/ขนส่ง/OTP/marketplace/streaming/work email/social/travel/telecom/gov
- ตัวเลือก 4 ข้อ “ต่างกันชัดเจน”
- correctId ต้องอ้างถึง option.id (o1/o2/o3/o4)
- explanation สั้นๆแต่ชัดเจนรายข้อ
- signals อย่างน้อย 2

หลีกเลี่ยง stem คล้ายเดิม:
${avoidStems.map((s) => `- ${s}`).join("\n")}

หลีกเลี่ยง signals ซ้ำเยอะ:
${avoidSignals.map((s) => `- ${s}`).join("\n")}

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
  const t = setTimeout(() => controller.abort(), 25_000);

  try {
    const resp = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: "You output ONLY valid JSON. No markdown." },
          { role: "user", content: prompt },
        ],
        // ✅ สำคัญ: บังคับ JSON
        response_format: { type: "json_object" } as any,
        temperature: 0.65,
        max_tokens: 700,
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
    ? body.recentHashes.slice(0, 120).map(String).filter(Boolean)
    : [];

  const recentSignals: string[] = Array.isArray(body?.recentSignals)
    ? body.recentSignals.slice(0, 60).map(String).filter(Boolean)
    : [];

  const recentStems: string[] = Array.isArray(body?.recentStems)
    ? body.recentStems.slice(0, 60).map(String).filter(Boolean)
    : [];

  const freshOnly = body?.freshOnly === true; // ✅ ส่งมาจาก client ถ้าอยาก “ไม่ใช้ DB เก่า”

  // ✅ ถ้าไม่ freshOnly ค่อยหยิบจาก DB ก่อนเพื่อให้เร็ว
  if (!freshOnly) {
    const cached = await getCachedQuiz(recentHashes);
    if (cached) return NextResponse.json({ quiz: cached });
  }

  // ✅ สร้างใหม่ด้วย AI (พยายาม 4 ครั้ง)
  for (let attempt = 0; attempt < 4; attempt++) {
    const q = await generateQuizAI(recentSignals.slice(-20), recentStems.slice(-25));
    if (!q) continue;

    if (recentHashes.includes(q.hash)) continue;

    // บันทึกลง DB (เพื่อให้อนาคตยิ่งเร็วขึ้น)
    try {
      await prisma.question.create({
        data: {
          hash: q.hash,
          contentJson: JSON.stringify({ ...q, kind: "quiz" }),
        },
      });
    } catch {
      // ignore (unique conflict ฯลฯ)
    }

    return NextResponse.json({ quiz: q });
  }

  // ✅ สุดท้าย: ไม่ค้างแล้ว — ส่ง fallback ทันที
  const fb = fallbackQuiz(recentHashes);
  return NextResponse.json({ quiz: fb });
}
