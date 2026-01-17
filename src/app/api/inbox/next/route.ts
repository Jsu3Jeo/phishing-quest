import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
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
  source?: "ai" | "fallback" | "db";
};

function normalizeText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(u: string) {
  return normalizeText(u).replace(/\s+/g, "");
}

/** ✅ สำคัญ: hash ต้อง stable ไม่ขึ้นกับลำดับ links */
function hashItem(i: Omit<ItemOut, "hash" | "kind" | "source">) {
  const linksNorm = (i.links || [])
    .map((l) => `${normalizeText(l.text)}|${normalizeUrl(l.url)}`)
    .sort(); // ✅ sort links

  const base =
    `${normalizeText(i.channel)}\n` +
    `${normalizeText(i.from)}\n` +
    `${normalizeText(i.to ?? "")}\n` +
    `${normalizeText(i.subject ?? "")}\n` +
    `${normalizeText(i.body)}\n` +
    linksNorm.join("\n");

  return sha256(base.toLowerCase());
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

/** ✅ fallback: เพิ่ม bank ให้หลากหลายขึ้น ลดโอกาสซ้ำ */
function fallbackInbox(recentHashes: string[]): ItemOut {
  const bank: Array<Omit<ItemOut, "hash" | "source">> = [
    {
      kind: "inbox",
      channel: "sms",
      from: "Kerry Express",
      body: "พัสดุของคุณมีค่าธรรมเนียมคงค้าง 9 บาท กรุณาชำระภายใน 30 นาทีเพื่อหลีกเลี่ยงการตีกลับ: kerry-th.link/pay",
      links: [{ text: "ชำระเงิน", url: "https://kerry-th.link/pay" }],
      verdict: "phishing",
      explanation: "เร่งด่วน+โดเมนแปลก ไม่ใช่ช่องทางทางการ ควรตรวจจากแอป/เว็บจริงเอง",
      redFlags: ["เร่งด่วนภายในเวลา", "โดเมนไม่ทางการ/ลิงก์ย่อ", "เรียกเก็บเงินเล็กน้อยล่อให้จ่าย"],
      safeActions: ["ตรวจในแอป/เว็บขนส่งทางการเอง", "อย่ากดลิงก์และอย่าใส่ข้อมูลบัตร", "รายงาน/บล็อกผู้ส่ง"],
    },
    {
      kind: "inbox",
      channel: "email",
      from: "noreply@netflix-support-help.com",
      subject: "บัญชีของคุณถูกระงับชั่วคราว",
      body: "เราไม่สามารถเรียกเก็บเงินสำหรับรอบบิลล่าสุดได้ กรุณายืนยันข้อมูลการชำระเงินภายใน 24 ชม. เพื่อหลีกเลี่ยงการระงับบัญชี",
      links: [{ text: "Verify Now", url: "https://netflix-support-help.com/billing" }],
      verdict: "phishing",
      explanation: "โดเมนเลียนแบบ ไม่ใช่ netflix.com และพยายามให้กรอกข้อมูลการเงินผ่านลิงก์",
      redFlags: ["โดเมนเลียนแบบ", "ขู่ระงับบัญชี", "ให้กดลิงก์ไปกรอกข้อมูลการเงิน"],
      safeActions: ["เข้าแอป/เว็บ Netflix โดยตรง", "ตรวจโดเมนและ URL ก่อนคลิก", "เปลี่ยนรหัสผ่านถ้าเผลอกด/กรอกข้อมูล"],
    },
    {
      kind: "inbox",
      channel: "email",
      from: "no-reply@shopee.co.th",
      subject: "แจ้งเตือนการเข้าสู่ระบบใหม่",
      body: "เราพบการเข้าสู่ระบบใหม่จากอุปกรณ์ที่คุณไม่รู้จัก หากไม่ใช่คุณ โปรดเปลี่ยนรหัสผ่านทันทีผ่านแอป Shopee",
      links: [{ text: "ศูนย์ช่วยเหลือ", url: "https://shopee.co.th/help" }],
      verdict: "legit",
      explanation: "โดเมนดูเป็นทางการ และแนะนำให้ทำผ่านแอป/ช่องทางทางการ ไม่ได้พาไปกรอกข้อมูลบนเว็บแปลก",
      redFlags: ["เป็นข้อความด้านความปลอดภัย ทำให้ลังเลได้"],
      safeActions: ["เข้าแอปตรวจอุปกรณ์ที่ล็อกอิน", "เปลี่ยนรหัสผ่านและเปิด 2FA", "อย่ากรอกข้อมูลในเว็บลิงก์แปลก"],
    },
    {
      kind: "inbox",
      channel: "sms",
      from: "TH-Post",
      body: "พัสดุถึงศูนย์คัดแยกแล้ว กรุณายืนยันที่อยู่เพื่อจัดส่ง: thaipost-th.cc/addr",
      links: [{ text: "ยืนยันที่อยู่", url: "https://thaipost-th.cc/addr" }],
      verdict: "phishing",
      explanation: "โดเมนไม่ใช่ของไปรษณีย์จริง และชวนให้ยืนยันข้อมูลผ่านลิงก์แปลก",
      redFlags: ["โดเมนคล้ายแต่ไม่ใช่ทางการ", "ชวนกรอกข้อมูลส่วนตัว", "มาจาก SMS แบบสุ่ม"],
      safeActions: ["เช็คเลขพัสดุจากแอป/เว็บทางการเอง", "อย่ากดลิงก์", "รายงาน/บล็อก"],
    },
    {
      kind: "inbox",
      channel: "email",
      from: "it-helpdesk@company-security.com",
      subject: "Action required: Password expires today",
      body: "รหัสผ่านของคุณจะหมดอายุวันนี้ กรุณาคลิกลิงก์เพื่อรีเซ็ตรหัสผ่านทันทีเพื่อหลีกเลี่ยงการล็อกบัญชี",
      links: [{ text: "Reset Password", url: "https://company-security.com/reset" }],
      verdict: "phishing",
      explanation: "อีเมลเร่งด่วนให้คลิกลิงก์รีเซ็ต อาจเป็นโดเมนปลอมเลียนแบบองค์กร",
      redFlags: ["เร่งด่วน/ขู่ล็อกบัญชี", "ให้คลิกลิงก์รีเซ็ต", "โดเมนผู้ส่งไม่น่าไว้ใจ"],
      safeActions: ["รีเซ็ตผ่านพอร์ทัล/ระบบจริงที่รู้จัก", "แจ้งทีม IT ผ่านช่องทางที่ยืนยันได้", "อย่ากรอกข้อมูลในลิงก์แปลก"],
    },
  ];

  for (let i = 0; i < 25; i++) {
    const pick = bank[Math.floor(Math.random() * bank.length)];
    const h = hashItem(pick as any);
    if (recentHashes.includes(h)) continue;
    return { ...(pick as any), hash: h, source: "fallback" };
  }

  const pick = bank[0];
  return { ...(pick as any), hash: hashItem(pick as any), source: "fallback" };
}

async function generateInboxFast(avoidHints: string[]) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const prompt = `
NONCE=${nonce}
สร้าง "อีเมลหรือ SMS" 1 ชิ้น สำหรับฝึกจับ phishing (ไทยเป็นหลัก) ให้สมจริง
- ตอบเป็น JSON อย่างเดียว
- verdict สุ่มได้ทั้ง "legit" หรือ "phishing"
- ต้องมี explanation, redFlags>=2, safeActions>=2
- หลีกเลี่ยงซ้ำ/คล้ายกับ: ${avoidHints.slice(0, 30).join(" | ")}

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
  const t = setTimeout(() => controller.abort(), 6500); // ✅ เร็วขึ้นอีก

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
    ? body.recentHashes.slice(0, 300).map(String).filter(Boolean)
    : [];

  const avoid = [
    ...recentHashes.map((h) => `hash:${h.slice(0, 10)}`),
    "ธนาคาร",
    "พัสดุ",
    "OTP",
    "บัญชี",
    "ชำระเงิน",
  ];

  // ✅ “กันซ้ำกับ DB” แบบเด็ดขาด: ถ้า hash นี้มีอยู่แล้ว ให้ generate ใหม่
  // ✅ พยายาม AI 3 ครั้ง (ยังไว) ถ้าไม่ได้ค่อย fallback
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await generateInboxFast(avoid);
    if (!item) continue;

    if (recentHashes.includes(item.hash)) continue;

    // ✅ เช็คซ้ำกับ DB ด้วย (กัน deploy หลาย user/หลาย tab)
    const exists = await prisma.question.findUnique({ where: { hash: item.hash } });
    if (exists) continue;

    // ✅ บันทึกลง DB แบบ best-effort (แต่ส่วนใหญ่จะผ่านเพราะเช็คแล้ว)
    prisma.question
      .create({ data: { hash: item.hash, contentJson: JSON.stringify(item) } })
      .catch(() => {});

    return NextResponse.json({ item });
  }

  // ✅ ไม่ 503 แล้ว: fallback ทันที
  return NextResponse.json({ item: fallbackInbox(recentHashes) });
}
