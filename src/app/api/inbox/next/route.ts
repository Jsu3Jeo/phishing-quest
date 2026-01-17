import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { sha256 } from "@/lib/utils";

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
  source?: "bank";
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

function buildOut(x: z.infer<typeof ItemSchema>): ItemOut {
  const hash = hashItem(x as any);
  return { kind: "inbox", ...(x as any), hash, source: "bank" };
}

/** ✅ 20 ชิ้น: Inbox Mode (ใช้โดเมนตัวอย่างเพื่อความปลอดภัย) */
const INBOX_BANK: z.infer<typeof ItemSchema>[] = [
  {
    channel: "sms",
    from: "Delivery-Notice",
    body: "พัสดุของคุณถูกตีกลับ กรุณายืนยันที่อยู่ภายใน 60 นาที: https://parcel-fix.example.com/addr",
    links: [{ text: "ยืนยันที่อยู่", url: "https://parcel-fix.example.com/addr" }],
    verdict: "phishing",
    explanation: "เร่งด่วน + ลิงก์แปลก ไม่ใช่ช่องทางขนส่งทางการ",
    redFlags: ["เร่งให้ทำภายในเวลา", "โดเมนไม่ทางการ", "ชวนกรอกข้อมูลส่วนตัว"],
    safeActions: ["เช็คสถานะจากแอป/เว็บขนส่งจริง", "อย่ากดลิงก์", "รายงาน/บล็อก"],
  },
  {
    channel: "email",
    from: "security@sample-mail.com",
    subject: "Unusual sign-in attempt",
    body: "We detected a login attempt. If this wasn’t you, secure your account immediately.",
    links: [{ text: "Secure account", url: "https://secure-login.sample-mail.com" }],
    verdict: "phishing",
    explanation: "โดเมนไม่ใช่ของผู้ให้บริการจริง + ลิงก์ให้ล็อกอินด่วน",
    redFlags: ["โดเมนผู้ส่งไม่ทางการ", "มีปุ่มให้ล็อกอินผ่านลิงก์", "ใช้ความกลัวเร่งให้ทำ"],
    safeActions: ["เข้าเว็บ/แอปจริงด้วยตัวเอง", "เปลี่ยนรหัสผ่านในระบบจริง", "เปิด 2FA"],
  },
  {
    channel: "email",
    from: "no-reply@service.example.com",
    subject: "ใบเสร็จรับเงิน (Receipt) สำหรับคำสั่งซื้อของคุณ",
    body: "ขอบคุณสำหรับการสั่งซื้อ หากคุณไม่ได้ทำรายการ โปรดติดต่อศูนย์ช่วยเหลือผ่านหน้าเว็บไซต์ทางการ",
    links: [{ text: "Help Center", url: "https://service.example.com/help" }],
    verdict: "legit",
    explanation: "เนื้อหาไม่เร่งรัด ไม่ขอข้อมูลสำคัญ และลิงก์ไปหน้า help ปกติ",
    redFlags: ["อีเมลเกี่ยวกับการซื้อขายอาจทำให้ตกใจได้"],
    safeActions: ["ตรวจรายการซื้อในบัญชีทางการ", "อย่าดาวน์โหลดไฟล์แนบแปลกๆ", "ติดต่อช่องทางทางการ"],
  },
  {
    channel: "sms",
    from: "Bank-Alert",
    body: "ตรวจพบธุรกรรมผิดปกติ กรุณายืนยัน OTP เพื่อยกเลิก: https://bank-verify.example.net/otp",
    links: [{ text: "ยืนยัน OTP", url: "https://bank-verify.example.net/otp" }],
    verdict: "phishing",
    explanation: "ธนาคารจริงไม่ขอ OTP ผ่านลิงก์ SMS แบบนี้",
    redFlags: ["ขอ OTP", "ลิงก์ใน SMS", "อ้างธุรกรรมผิดปกติให้รีบทำ"],
    safeActions: ["โทรกลับเบอร์ธนาคารจากหลังบัตร", "เข้าแอปธนาคารตรวจรายการเอง", "อย่าให้ OTP"],
  },
  {
    channel: "email",
    from: "it-helpdesk@company.example.com",
    subject: "Maintenance notice",
    body: "คืนนี้มีการปรับปรุงระบบ อาจมีช่วงเวลาที่เข้าใช้งานไม่ได้เล็กน้อย ไม่มีการขอรหัสผ่านหรือ OTP",
    links: [{ text: "Status page", url: "https://company.example.com/status" }],
    verdict: "legit",
    explanation: "เป็นประกาศทั่วไป ไม่ขอข้อมูลส่วนตัว และมีลิงก์สถานะระบบ",
    redFlags: ["อีเมล IT อาจถูกปลอมได้เสมอ"],
    safeActions: ["ตรวจโดเมนผู้ส่ง", "เข้า URL ด้วยตัวเองถ้าสงสัย", "อย่าให้รหัสผ่าน/OTP"],
  },
  // ---- เติมให้ครบ 20 ----
  {
    channel: "sms",
    from: "Rewards",
    body: "คุณได้รับคูปองมูลค่า 500 บาท กดรับภายในวันนี้: https://coupon-gift.example.com",
    links: [{ text: "รับคูปอง", url: "https://coupon-gift.example.com" }],
    verdict: "phishing",
    explanation: "ล่อด้วยของฟรี + เร่งเวลา เป็นสัญญาณหลอกลวง",
    redFlags: ["ของฟรีเกินจริง", "เร่งด่วน", "ลิงก์ไม่ทางการ"],
    safeActions: ["เช็คโปรโมชันในแอป/เว็บทางการ", "อย่ากดลิงก์", "บล็อกผู้ส่ง"],
  },
  {
    channel: "email",
    from: "billing@streaming.example.com",
    subject: "Payment failed",
    body: "เราเรียกเก็บเงินไม่สำเร็จ กรุณาอัปเดตวิธีชำระเงินในบัญชีของคุณ (ทำผ่านหน้า Account เท่านั้น)",
    links: [{ text: "Account", url: "https://streaming.example.com/account" }],
    verdict: "legit",
    explanation: "ชี้ให้ไปที่หน้า account ปกติ ไม่เร่งให้กรอกผ่านฟอร์มแปลก",
    redFlags: ["เรื่องการเงินทำให้รีบได้"],
    safeActions: ["เข้าเว็บ/แอปด้วยตัวเอง", "ตรวจ URL ให้ถูก", "อย่ากรอกข้อมูลในลิงก์แปลก"],
  },
  {
    channel: "email",
    from: "hr@company.example.com",
    subject: "เอกสารเงินเดือน",
    body: "สลิปเงินเดือนอยู่ในพอร์ทัลพนักงาน กรุณาเข้าสู่ระบบผ่านลิงก์พอร์ทัลเท่านั้น",
    links: [{ text: "Employee portal", url: "https://company.example.com/portal" }],
    verdict: "legit",
    explanation: "ไม่มีไฟล์แนบสุ่ม และชี้ไปยังพอร์ทัลขององค์กร",
    redFlags: ["HR มักถูกปลอมได้"],
    safeActions: ["เปิดพอร์ทัลจาก bookmark/URL ที่รู้จัก", "อย่าเปิดไฟล์แนบ .zip/.exe", "ถาม HR ผ่านช่องทางภายใน"],
  },
  {
    channel: "sms",
    from: "TH-Post",
    body: "พัสดุถึงคลังแล้ว กรุณาชำระค่าธรรมเนียม 12 บาท: https://post-fee.example.com/pay",
    links: [{ text: "ชำระเงิน", url: "https://post-fee.example.com/pay" }],
    verdict: "phishing",
    explanation: "ขอเงินเล็กน้อย + ลิงก์แปลก เป็นมุกหลอกคลาสสิก",
    redFlags: ["เรียกเก็บเงินเล็กน้อย", "ลิงก์ไม่ทางการ", "เร่งให้จ่าย"],
    safeActions: ["เช็คในแอป/เว็บจริง", "อย่ากดลิงก์", "รายงาน/บล็อก"],
  },
  {
    channel: "email",
    from: "support@market.example.com",
    subject: "แจ้งเตือนการเข้าสู่ระบบใหม่",
    body: "หากไม่ใช่คุณ กรุณาเปลี่ยนรหัสผ่านผ่านหน้า Security Settings ในบัญชี",
    links: [{ text: "Security Settings", url: "https://market.example.com/security" }],
    verdict: "legit",
    explanation: "แนะนำให้ทำผ่านหน้า security settings และไม่ขอ OTP ทางอีเมล",
    redFlags: ["แจ้งเตือนความปลอดภัยทำให้ตกใจได้"],
    safeActions: ["เข้าเว็บด้วยตัวเอง", "เปลี่ยนรหัสผ่าน/ออกจากระบบทุกอุปกรณ์", "เปิด 2FA"],
  },
  {
    channel: "email",
    from: "it@company.example.com",
    subject: "Please install update",
    body: "ดาวน์โหลดไฟล์แนบ Update.exe แล้วรันเพื่ออัปเดตระบบ",
    links: [],
    attachments: ["Update.exe"],
    verdict: "phishing",
    explanation: "ไฟล์ .exe แนบอีเมลคือความเสี่ยงมัลแวร์สูงมาก",
    redFlags: ["แนบไฟล์ .exe", "สั่งให้รันโปรแกรม", "อ้างเป็น IT"],
    safeActions: ["อย่าเปิดไฟล์", "ติดต่อ IT ผ่านช่องทางภายใน", "สแกนเครื่องถ้าดาวน์โหลดไปแล้ว"],
  },
  {
    channel: "sms",
    from: "Job-Offer",
    body: "รับงานกดไลก์ได้เงิน 300/วัน แอดไลน์และโอนค่ายืนยัน 99 บาท: https://work-fast.example.com",
    links: [{ text: "สมัครงาน", url: "https://work-fast.example.com" }],
    verdict: "phishing",
    explanation: "งานจริงไม่เก็บค่ายืนยัน และสัญญาเงินง่ายเกินจริง",
    redFlags: ["ขอให้โอนเงินก่อน", "สัญญาเงินง่ายๆ", "ลิงก์สุ่ม"],
    safeActions: ["หางานผ่านแหล่งน่าเชื่อถือ", "อย่าโอนเงิน", "บล็อก/รายงาน"],
  },
  // เติมให้ครบ 20 แบบกระชับ
  {
    channel: "email",
    from: "travel@booking.example.com",
    subject: "Booking confirmed",
    body: "การจองของคุณยืนยันแล้ว คุณสามารถดูรายละเอียดในบัญชีของคุณ",
    links: [{ text: "View booking", url: "https://booking.example.com/my" }],
    verdict: "legit",
    explanation: "ลิงก์ไปหน้าบัญชี ไม่ขอข้อมูลสำคัญ",
    redFlags: ["อีเมลจองมักถูกปลอมได้"],
    safeActions: ["ตรวจในบัญชีจริง", "อย่ากดลิงก์ถ้าสงสัยโดเมน", "ติดต่อศูนย์ช่วยเหลือทางการ"],
  },
  {
    channel: "email",
    from: "alerts@booking-example.net",
    subject: "Cancel booking now",
    body: "หากคุณไม่ได้จอง กรุณากดยกเลิกทันที",
    links: [{ text: "Cancel", url: "https://cancel.booking-example.net" }],
    verdict: "phishing",
    explanation: "โดเมนเลียนแบบ + ปุ่มยกเลิกเร่งด่วน",
    redFlags: ["โดเมนเลียนแบบ", "เร่งให้กดปุ่ม", "คุณไม่ได้ทำรายการ"],
    safeActions: ["เข้าเว็บจริงด้วยตัวเอง", "อย่ากดปุ่มในอีเมล", "ตรวจรายการจองในบัญชี"],
  },
  {
    channel: "sms",
    from: "Mobile-Plan",
    body: "แพ็กเกจจะหมดอายุ กรุณายืนยันบัตรเพื่อคงสิทธิ์: https://plan-keep.example.com",
    links: [{ text: "ยืนยัน", url: "https://plan-keep.example.com" }],
    verdict: "phishing",
    explanation: "ผู้ให้บริการไม่ควรให้ยืนยันบัตรผ่านลิงก์สุ่ม",
    redFlags: ["ขอข้อมูลบัตร", "ลิงก์แปลก", "เร่งด่วน"],
    safeActions: ["เช็คในแอปผู้ให้บริการ", "อย่ากดลิงก์", "บล็อกผู้ส่ง"],
  },
  {
    channel: "email",
    from: "no-reply@cloud.example.com",
    subject: "Storage almost full",
    body: "พื้นที่ใกล้เต็ม คุณสามารถจัดการ/อัปเกรดได้จากหน้า Billing ในบัญชี",
    links: [{ text: "Billing", url: "https://cloud.example.com/billing" }],
    verdict: "legit",
    explanation: "เป็นข้อความทั่วไป ไม่ขอรหัสผ่าน/OTP และลิงก์เป็นหน้า billing ปกติ",
    redFlags: ["อีเมลแจ้งพื้นที่เต็มมักถูกใช้หลอกได้"],
    safeActions: ["เข้าเว็บด้วยตัวเอง", "ตรวจ URL", "อย่าล็อกอินผ่านลิงก์แปลก"],
  },
  {
    channel: "email",
    from: "cloud-support@cloud-secure.example.net",
    subject: "Storage full — login now",
    body: "พื้นที่เต็มแล้ว กรุณาล็อกอินเพื่อเพิ่มพื้นที่ทันที",
    links: [{ text: "Login", url: "https://cloud-secure.example.net/login" }],
    verdict: "phishing",
    explanation: "โดเมนไม่ตรงของจริง + เร่งให้ล็อกอินผ่านลิงก์",
    redFlags: ["โดเมนไม่ทางการ", "เร่งให้ล็อกอิน", "ใช้ปัญหาเร่งด่วนหลอกคลิก"],
    safeActions: ["เข้า cloud ผ่าน URL ที่รู้จัก", "อย่ากดลิงก์", "รายงานอีเมล"],
  },
  {
    channel: "sms",
    from: "Friend",
    body: "ช่วยโหวตให้หน่อยได้ไหม https://vote-now.example.com",
    links: [{ text: "โหวต", url: "https://vote-now.example.com" }],
    verdict: "phishing",
    explanation: "มุกปลอมเป็นคนรู้จัก ส่งลิงก์ให้กด",
    redFlags: ["ลิงก์สั้น/แปลก", "อ้างว่าเป็นเพื่อน", "ชวนกดทันที"],
    safeActions: ["ถามเพื่อนทางช่องทางอื่น", "อย่ากดลิงก์", "รายงาน/บล็อก"],
  },
  {
    channel: "email",
    from: "notice@school.example.com",
    subject: "ประกาศผลสอบ",
    body: "ผลสอบประกาศบนหน้าเว็บไซต์นักเรียน กรุณาเข้าสู่ระบบตามปกติ",
    links: [{ text: "Student portal", url: "https://school.example.com/portal" }],
    verdict: "legit",
    explanation: "ชี้ไปพอร์ทัลปกติ ไม่ขอข้อมูลผ่านฟอร์มลิงก์แปลก",
    redFlags: ["ผลสอบทำให้รีบคลิกได้"],
    safeActions: ["เข้าเว็บด้วยตัวเอง", "ตรวจโดเมน", "อย่าให้รหัสผ่าน/OTP"],
  },
  {
    channel: "email",
    from: "admin@school-portal.example.net",
    subject: "ผลสอบออกแล้ว! Login ด่วน",
    body: "เข้าสู่ระบบเพื่อดูผลสอบทันที",
    links: [{ text: "Login", url: "https://school-portal.example.net/login" }],
    verdict: "phishing",
    explanation: "โดเมนเลียนแบบ + เร่งให้ล็อกอิน",
    redFlags: ["โดเมนเลียนแบบ", "เร่งด่วน", "ชวนล็อกอินผ่านลิงก์"],
    safeActions: ["เข้าเว็บโรงเรียนจริง", "อย่ากดลิงก์", "แจ้งครู/ผู้ดูแลระบบ"],
  },
];

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // ✅ เลือกจาก answered -> วน 20 ชิ้น
  const answered = Number(body?.answered ?? 0);
  const idx = Number.isFinite(answered) && answered >= 0 ? answered % INBOX_BANK.length : 0;

  const item = INBOX_BANK[idx];
  const parsed = ItemSchema.safeParse(item);

  if (!parsed.success) {
    const fallback = INBOX_BANK[0];
    return NextResponse.json({ item: buildOut(ItemSchema.parse(fallback)) });
  }

  return NextResponse.json({ item: buildOut(parsed.data) });
}
