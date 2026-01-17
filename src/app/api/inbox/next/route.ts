import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ItemOut = {
  kind: "inbox";
  channel: "email" | "sms";
  from: string;
  to?: string;
  subject?: string;
  body: string;
  links: Array<{ text: string; url: string }>;
  attachments?: string[];
  verdict: "legit" | "phishing";
  explanation: string;
  redFlags: string[];
  safeActions: string[];
  hash: string;
  source: "fixed20";
};

function normalizeText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(u: string) {
  return normalizeText(u).replace(/\s+/g, "");
}

/** ✅ hash stable ไม่ขึ้นกับลำดับ links */
function hashItem(i: Omit<ItemOut, "hash" | "source">) {
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

/** ✅ 20 ชิ้น: 10 phishing + 10 legit (คละ email/sms) */
const BANK: Array<Omit<ItemOut, "hash" | "source">> = [
  // ---------------- PHISHING (1-10) ----------------
  {
    kind: "inbox",
    channel: "sms",
    from: "Kerry Express",
    body: "พัสดุของคุณมีค่าธรรมเนียมคงค้าง 9 บาท กรุณาชำระภายใน 30 นาทีเพื่อหลีกเลี่ยงการตีกลับ: kerry-th.link/pay",
    links: [{ text: "ชำระเงิน", url: "https://kerry-th.link/pay" }],
    verdict: "phishing",
    explanation: "เร่งด่วน+โดเมนแปลก ไม่ใช่ช่องทางทางการ มักใช้ล่อให้กรอกข้อมูลบัตร",
    redFlags: ["เร่งด่วนภายในเวลา", "โดเมนไม่ทางการ/ลิงก์ย่อ", "เรียกเก็บเงินเล็กน้อยล่อให้จ่าย"],
    safeActions: ["ตรวจเลขพัสดุในแอป/เว็บทางการเอง", "อย่ากดลิงก์และอย่าใส่ข้อมูลบัตร", "รายงาน/บล็อกผู้ส่ง"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "noreply@netflix-support-help.com",
    subject: "บัญชีของคุณถูกระงับชั่วคราว",
    body: "เราไม่สามารถเรียกเก็บเงินสำหรับรอบบิลล่าสุดได้ กรุณายืนยันข้อมูลการชำระเงินภายใน 24 ชม. เพื่อหลีกเลี่ยงการระงับบัญชี",
    links: [{ text: "Verify Now", url: "https://netflix-support-help.com/billing" }],
    verdict: "phishing",
    explanation: "โดเมนเลียนแบบ ไม่ใช่ netflix.com และพยายามหลอกให้กรอกข้อมูลการเงิน",
    redFlags: ["โดเมนเลียนแบบ", "ขู่ระงับบัญชี", "พาไปกรอกข้อมูลการเงิน"],
    safeActions: ["เข้าแอป/เว็บ Netflix โดยตรง", "ตรวจโดเมนผู้ส่ง/URL ก่อนคลิก", "เปลี่ยนรหัสผ่านถ้าเผลอกด/กรอกข้อมูล"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "TH-Post",
    body: "พัสดุถึงศูนย์คัดแยกแล้ว กรุณายืนยันที่อยู่เพื่อจัดส่ง: thaipost-th.cc/addr",
    links: [{ text: "ยืนยันที่อยู่", url: "https://thaipost-th.cc/addr" }],
    verdict: "phishing",
    explanation: "โดเมนไม่ใช่ของไปรษณีย์จริง และชวนให้กรอกข้อมูลผ่านลิงก์แปลก",
    redFlags: ["โดเมนคล้ายแต่ไม่ใช่ทางการ", "ชวนกรอกข้อมูลส่วนตัว", "ส่งมาแบบสุ่ม"],
    safeActions: ["เช็คเลขพัสดุในเว็บ/แอปทางการเอง", "อย่ากดลิงก์", "รายงาน/บล็อก"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "it-helpdesk@company-security.com",
    subject: "Action required: Password expires today",
    body: "รหัสผ่านของคุณจะหมดอายุวันนี้ กรุณาคลิกลิงก์เพื่อรีเซ็ตรหัสผ่านทันทีเพื่อหลีกเลี่ยงการล็อกบัญชี",
    links: [{ text: "Reset Password", url: "https://company-security.com/reset" }],
    verdict: "phishing",
    explanation: "เร่งด่วน+ให้คลิกลิงก์รีเซ็ต อาจเป็นโดเมนปลอมเลียนแบบองค์กร",
    redFlags: ["เร่งด่วน/ขู่ล็อกบัญชี", "ให้คลิกลิงก์รีเซ็ต", "โดเมนผู้ส่งไม่น่าไว้ใจ"],
    safeActions: ["รีเซ็ตผ่านพอร์ทัลจริงที่รู้จัก", "แจ้งทีม IT ผ่านช่องทางภายใน", "อย่ากรอกข้อมูลในลิงก์แปลก"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "Bank-Alert",
    body: "ตรวจพบธุรกรรมผิดปกติ กรุณายืนยันตัวตนภายใน 10 นาที: bank-secure.veri-fy.cc",
    links: [{ text: "ยืนยันตัวตน", url: "https://bank-secure.veri-fy.cc" }],
    verdict: "phishing",
    explanation: "โดเมนประหลาด+เร่งเวลา เป็นรูปแบบหลอกให้รีบกดลิงก์ไปเว็บปลอม",
    redFlags: ["โดเมนแปลก/ไม่ทางการ", "เร่งด่วนภายใน 10 นาที", "อ้างธุรกรรมผิดปกติให้กดลิงก์"],
    safeActions: ["โทรธนาคารผ่านเบอร์ทางการ/หลังบัตร", "เข้าแอปธนาคารเองเพื่อตรวจรายการ", "ไม่ให้ OTP/ข้อมูลบัตร"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "billing@apple-id-verify.com",
    subject: "Apple ID: Verify your billing",
    body: "เราไม่สามารถยืนยันข้อมูลการชำระเงินของคุณได้ โปรดยืนยันภายในวันนี้เพื่อหลีกเลี่ยงการปิดใช้งานบัญชี",
    links: [{ text: "Verify Billing", url: "https://apple-id-verify.com/verify" }],
    verdict: "phishing",
    explanation: "โดเมนเลียนแบบ Apple และพยายามให้กรอกข้อมูลบัตร/บัญชีผ่านเว็บนอกทางการ",
    redFlags: ["โดเมนไม่ใช่ apple.com", "ขู่ปิดบัญชี", "ให้กดลิงก์กรอกข้อมูลการเงิน"],
    safeActions: ["เข้า Settings/เว็บทางการด้วยตัวเอง", "ตรวจโดเมนก่อนเสมอ", "รายงานอีเมลฟิชชิง"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "TrueMove H",
    body: "แพ็กเกจของคุณจะถูกระงับ กรุณายืนยันข้อมูลและชำระค่าบริการ: tru-th.pay-now.cc",
    links: [{ text: "ชำระค่าบริการ", url: "https://tru-th.pay-now.cc" }],
    verdict: "phishing",
    explanation: "อ้างค่ายมือถือแต่ใช้โดเมนแปลก+เร่งให้จ่ายเงินผ่านลิงก์",
    redFlags: ["โดเมนแปลก", "ขู่ระงับบริการ", "ให้จ่ายเงินผ่านลิงก์"],
    safeActions: ["เปิดแอป/เว็บค่ายมือถือทางการเอง", "อย่ากดลิงก์", "โทรศูนย์บริการจากเบอร์ทางการ"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "hr@company-payroll-update.com",
    subject: "อัปเดตบัญชีรับเงินเดือนด่วน",
    body: "เพื่อให้ทันรอบจ่ายเงินเดือน กรุณากรอกเลขบัญชีและ OTP ที่ส่งไปยังโทรศัพท์ของคุณในฟอร์มนี้",
    links: [{ text: "Update Payroll", url: "https://company-payroll-update.com/form" }],
    verdict: "phishing",
    explanation: "HR จริงจะไม่ขอ OTP และไม่ให้กรอกข้อมูลผ่านโดเมนแปลกๆ",
    redFlags: ["ขอ OTP", "เร่งด่วนทันรอบเงินเดือน", "โดเมนองค์กรไม่คุ้น/นอกระบบ"],
    safeActions: ["ยืนยันกับ HR ผ่านช่องทางภายใน", "อย่าให้ OTP/ข้อมูลบัตร", "รายงานทีมความปลอดภัย/IT"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "TikTok Support",
    body: "บัญชีคุณละเมิดนโยบาย โปรดยืนยันเพื่อหลีกเลี่ยงการแบน: tiktok-verify.help/appeal",
    links: [{ text: "ยื่นอุทธรณ์", url: "https://tiktok-verify.help/appeal" }],
    verdict: "phishing",
    explanation: "โดเมนไม่ทางการและใช้ความกลัว (แบน) เพื่อหลอกให้กดลิงก์",
    redFlags: ["โดเมนไม่ใช่ทางการ", "ขู่แบน", "ชวนล็อกอินผ่านลิงก์"],
    safeActions: ["เปิดแอป TikTok เองเพื่อตรวจแจ้งเตือน", "อย่ากดลิงก์จาก SMS", "เปลี่ยนรหัสผ่านหากสงสัย"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "document-share@drive-google-docs.com",
    subject: "คุณถูกแท็กในเอกสารสำคัญ",
    body: "มีคนแชร์เอกสารให้คุณ กรุณา Sign in เพื่อดูเอกสาร",
    links: [{ text: "Open Document", url: "https://drive-google-docs.com/login" }],
    verdict: "phishing",
    explanation: "โดเมนปลอมเลียนแบบ Google Docs พาไปหน้า login หลอกขโมยรหัสผ่าน",
    redFlags: ["โดเมนไม่ใช่ google.com", "พาไปหน้า Sign in ผ่านลิงก์", "อ้างเอกสารสำคัญให้รีบเปิด"],
    safeActions: ["เปิด Google Drive ผ่านเว็บ/แอปทางการเอง", "ตรวจโดเมนก่อนล็อกอิน", "รายงานฟิชชิง"],
  },

  // ---------------- LEGIT (11-20) ----------------
  {
    kind: "inbox",
    channel: "sms",
    from: "LINE",
    body: "รหัสยืนยัน LINE ของคุณคือ 839201 (ใช้ได้ 5 นาที) หากคุณไม่ได้ร้องขอ โปรดละเว้น",
    links: [],
    verdict: "legit",
    explanation: "เป็น OTP มาตรฐาน ไม่มีลิงก์ให้กด และระบุชัดว่าไม่ได้ขอให้ละเว้น",
    redFlags: ["หาก OTP มาเอง แปลว่ามีคนพยายามล็อกอิน"],
    safeActions: ["อย่าให้รหัสนี้กับใคร", "เปลี่ยนรหัสผ่านถ้าสงสัย", "เปิด 2FA/ตรวจอุปกรณ์"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "no-reply@shopee.co.th",
    subject: "แจ้งเตือนการเข้าสู่ระบบใหม่",
    body: "เราพบการเข้าสู่ระบบใหม่จากอุปกรณ์ที่คุณไม่รู้จัก หากไม่ใช่คุณ โปรดเปลี่ยนรหัสผ่านทันทีผ่านแอป Shopee",
    links: [{ text: "ศูนย์ช่วยเหลือ", url: "https://shopee.co.th/help" }],
    verdict: "legit",
    explanation: "โดเมนดูเป็นทางการและแนะนำให้ทำผ่านแอป/ช่องทางทางการ ไม่ได้ขอข้อมูลบัตรหรือ OTP",
    redFlags: ["ข้อความความปลอดภัยอาจทำให้ตกใจรีบกดโดยไม่ตรวจ"],
    safeActions: ["เข้าแอปตรวจอุปกรณ์ที่ล็อกอิน", "เปลี่ยนรหัสผ่านและเปิด 2FA", "ถ้าไม่มั่นใจให้พิมพ์ URL เอง"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "support@google.com",
    subject: "Security alert",
    body: "เราพบการพยายามเข้าสู่ระบบจากอุปกรณ์ใหม่ คุณสามารถตรวจสอบกิจกรรมบัญชีได้จากหน้า Security ในบัญชี Google",
    links: [{ text: "Google Account", url: "https://myaccount.google.com/security" }],
    verdict: "legit",
    explanation: "ลิงก์ไปโดเมนทางการ และไม่ได้ขอรหัสผ่าน/OTP ผ่านอีเมล",
    redFlags: ["หัวข้อแนว security ทำให้รีบคลิกโดยไม่ตรวจได้"],
    safeActions: ["เข้า myaccount.google.com เองถ้าไม่มั่นใจ", "ตรวจอุปกรณ์/Session", "เปิด 2FA"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "noreply@github.com",
    subject: "New sign-in to GitHub",
    body: "มีการเข้าสู่ระบบใหม่ หากไม่ใช่คุณ ให้ไปที่ Settings > Security เพื่อรีวิวเซสชันและเปลี่ยนรหัสผ่าน",
    links: [{ text: "GitHub Settings", url: "https://github.com/settings/security" }],
    verdict: "legit",
    explanation: "โดเมนทางการและแนะแนวทางให้ไปตั้งค่าในระบบ ไม่ได้ขอข้อมูลลับในอีเมล",
    redFlags: ["—"],
    safeActions: ["ตรวจอุปกรณ์ที่ล็อกอิน", "เปลี่ยนรหัสผ่าน", "เปิด 2FA"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "Grab",
    body: "ขอบคุณที่ใช้บริการ Grab ใบเสร็จและรายละเอียดการเดินทางอยู่ในแอปของคุณ",
    links: [],
    verdict: "legit",
    explanation: "เป็นข้อความแจ้งทั่วไป ไม่มีลิงก์/ขอข้อมูลส่วนตัว",
    redFlags: ["—"],
    safeActions: ["ตรวจรายละเอียดในแอป", "หากมีลิงก์แปลกค่อยสงสัย", "อย่าแชร์ OTP กับใคร"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "no-reply@spotify.com",
    subject: "การยืนยันอีเมลของคุณ",
    body: "กรุณายืนยันอีเมลเพื่อเปิดใช้งานบัญชี Spotify ของคุณ (ถ้าคุณไม่ได้สมัคร ให้ละเว้น)",
    links: [{ text: "Verify email", url: "https://www.spotify.com/th/account/" }],
    verdict: "legit",
    explanation: "โดเมนทางการและเนื้อหาไม่เร่งให้กรอกข้อมูลการเงิน/OTP",
    redFlags: ["—"],
    safeActions: ["ถ้าไม่ได้สมัครให้ละเว้น", "เข้าเว็บทางการด้วยตัวเองได้", "อย่าให้รหัสผ่านกับใคร"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "SCB",
    body: "รหัส OTP สำหรับทำรายการของคุณคือ 447912 (ใช้ได้ 3 นาที) หากไม่ใช่คุณ โปรดติดต่อธนาคาร",
    links: [],
    verdict: "legit",
    explanation: "OTP ที่ดีมักไม่มีลิงก์และไม่ขอให้ตอบกลับด้วย OTP",
    redFlags: ["ถ้ามาเองโดยไม่ได้ทำรายการ ต้องระวัง"],
    safeActions: ["อย่าให้ OTP กับใคร", "เข้าแอปธนาคารตรวจรายการ", "โทรธนาคารผ่านเบอร์ทางการหากสงสัย"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "no-reply@facebookmail.com",
    subject: "We noticed a new login",
    body: "เราแจ้งเตือนการเข้าสู่ระบบใหม่ คุณสามารถตรวจสอบความปลอดภัยได้จากเมนู Security ในบัญชีของคุณ",
    links: [{ text: "Security", url: "https://www.facebook.com/security/2fac/settings/" }],
    verdict: "legit",
    explanation: "โดเมนทางการ (facebookmail) และลิงก์ไปโดเมนหลัก ไม่ขอข้อมูลลับ",
    redFlags: ["ข้อความ security ทำให้รีบคลิกได้"],
    safeActions: ["ถ้าไม่มั่นใจให้เข้า Facebook เอง", "ตรวจอุปกรณ์ที่ล็อกอิน", "เปิด 2FA"],
  },
  {
    kind: "inbox",
    channel: "email",
    from: "noreply@lazada.co.th",
    subject: "ยืนยันการสั่งซื้อ #LAZ12345",
    body: "ขอบคุณสำหรับการสั่งซื้อ คุณสามารถตรวจสถานะคำสั่งซื้อได้ในบัญชีของคุณในแอป/เว็บไซต์ทางการ",
    links: [{ text: "ดูคำสั่งซื้อ", url: "https://www.lazada.co.th" }],
    verdict: "legit",
    explanation: "เป็นอีเมลอัปเดตคำสั่งซื้อทั่วไป โดเมนดูปกติและไม่มีการขอ OTP/ข้อมูลบัตร",
    redFlags: ["—"],
    safeActions: ["ตรวจสถานะในแอป/เว็บเอง", "ถ้าเจอลิงก์โดเมนแปลกอย่ากด", "ตรวจยอดชำระเงินในระบบ"],
  },
  {
    kind: "inbox",
    channel: "sms",
    from: "AIS",
    body: "แจ้งเตือน: รอบบิลเดือนนี้สามารถตรวจสอบได้ในแอป myAIS หากมีข้อสงสัยติดต่อ 1175",
    links: [],
    verdict: "legit",
    explanation: "แจ้งให้ไปตรวจในแอปทางการ ไม่มีลิงก์ให้จ่ายเงินหรือขอข้อมูลส่วนตัว",
    redFlags: ["—"],
    safeActions: ["เปิดแอป myAIS ตรวจรอบบิล", "ติดต่อเบอร์ศูนย์บริการทางการ", "อย่ากดลิงก์แปลกถ้ามีคนส่งเพิ่ม"],
  },
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  // ✅ วนตาม answered % 20 (ไม่ต้องพึ่ง AI/DB เลย)
  const answered = Number(body?.answered ?? 0);
  const idx = Number.isFinite(answered) ? Math.abs(answered) % BANK.length : 0;

  const base = BANK[idx];

  const item: ItemOut = {
    ...(base as any),
    hash: hashItem(base as any),
    source: "fixed20",
  };

  return NextResponse.json({ item });
}
