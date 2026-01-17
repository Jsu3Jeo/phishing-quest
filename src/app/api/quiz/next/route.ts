import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { sha256 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuizOptionSchema = z.object({
  text: z.string().min(2),
  explanation: z.string().min(3),
  isCorrect: z.boolean(),
});

const QuizBankItemSchema = z.object({
  stem: z.string().min(10),
  options: z.array(QuizOptionSchema).length(4),
  whyCorrect: z.string().min(5),
  signals: z.array(z.string()).min(2),
});

type QuizBankItem = z.infer<typeof QuizBankItemSchema>;

export type QuizOut = {
  kind: "quiz";
  stem: string;
  options: { label: "A" | "B" | "C" | "D"; text: string; isCorrect: boolean; explanation: string }[];
  whyCorrect: string;
  signals: string[];
  hash: string;
  source?: "bank";
};

function normalizeText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** ✅ hash stable ไม่ขึ้นกับลำดับตัวเลือก */
function hashQuiz(stem: string, optionTexts: string[]) {
  const stemN = normalizeText(stem).toLowerCase();
  const optsN = optionTexts.map((t) => normalizeText(t).toLowerCase()).sort();
  return sha256(stemN + "\n" + optsN.join("\n"));
}

function buildOut(q: QuizBankItem): QuizOut {
  const labels = ["A", "B", "C", "D"] as const;

  // ✅ กันพัง: ต้องมีคำตอบถูก “แค่ข้อเดียว”
  const correctCount = q.options.filter((o) => o.isCorrect).length;
  if (correctCount !== 1) {
    // ถ้าเผลอแก้ bank ผิด จะไม่ทำให้ API ล่ม
    const fixed = q.options.map((o, i) => ({ ...o, isCorrect: i === 0 }));
    const hash = hashQuiz(q.stem, fixed.map((x) => x.text));
    return {
      kind: "quiz",
      stem: q.stem,
      options: fixed.map((o, i) => ({ label: labels[i], ...o })),
      whyCorrect: q.whyCorrect,
      signals: q.signals,
      hash,
      source: "bank",
    };
  }

  const hash = hashQuiz(q.stem, q.options.map((x) => x.text));
  return {
    kind: "quiz",
    stem: q.stem,
    options: q.options.map((o, i) => ({ label: labels[i], ...o })),
    whyCorrect: q.whyCorrect,
    signals: q.signals,
    hash,
    source: "bank",
  };
}

/** ✅ 20 ข้อ: Quiz Mode */
const QUIZ_BANK: QuizBankItem[] = [
  {
    stem: "คุณได้อีเมลหัวข้อ “ยืนยันบัญชีด่วน” บอกว่าบัญชีจะถูกระงับภายใน 2 ชั่วโมง ถ้าไม่กดลิงก์ยืนยัน คุณควรทำอย่างไร?",
    options: [
      { text: "เข้าแอป/เว็บของบริการนั้นด้วยตัวเอง (พิมพ์ URL เอง) แล้วเช็คแจ้งเตือนในบัญชี", explanation: "ปลอดภัยสุด เพราะไม่คลิกลิงก์จากอีเมล", isCorrect: true },
      { text: "กดลิงก์ในอีเมลเพื่อยืนยันให้จบๆไป", explanation: "เสี่ยงเข้าเว็บปลอมและโดนขโมยรหัสผ่าน", isCorrect: false },
      { text: "ตอบกลับอีเมลเพื่อขอให้ส่งลิงก์ใหม่", explanation: "ผู้โจมตีจะยิ่งยืนยันว่าคุณเป็นเป้าหมาย", isCorrect: false },
      { text: "ส่งอีเมลให้เพื่อนลองกดลิงก์ดู", explanation: "ทำให้คนอื่นเสี่ยงด้วย และยังไม่ใช่วิธีตรวจสอบที่ถูก", isCorrect: false },
    ],
    whyCorrect: "อย่าเชื่อความเร่งด่วนจากอีเมล ตรวจสอบผ่านช่องทางทางการด้วยตัวเอง",
    signals: ["ขู่ระงับบัญชี", "เร่งด่วนให้กดลิงก์"],
  },
  {
    stem: "SMS แจ้งว่า “คุณได้รับเงินคืนภาษี” ให้กดลิงก์เพื่อกรอกเลขบัตร/OTP คุณควรเลือกข้อใด?",
    options: [
      { text: "ไม่กดลิงก์ และตรวจสอบผ่านเว็บ/แอปหน่วยงานรัฐที่ถูกต้องเอง", explanation: "ตัดความเสี่ยงเว็บปลอม/ขโมยข้อมูล", isCorrect: true },
      { text: "กรอกเลขบัตรก่อน เพราะเป็นเรื่องภาษี น่าจะจริง", explanation: "ข้อมูลส่วนตัวสำคัญมาก เสี่ยงถูกสวมสิทธิ์", isCorrect: false },
      { text: "กดลิงก์ แต่ไม่กรอกอะไร แค่ดูหน้าเว็บ", explanation: "บางเว็บแค่เข้าก็อาจโดน redirect/หลอกต่อ", isCorrect: false },
      { text: "ส่ง OTP ให้เขาเพื่อยืนยันเร็วๆ", explanation: "OTP คือกุญแจยึดบัญชี ห้ามให้ใครเด็ดขาด", isCorrect: false },
    ],
    whyCorrect: "หน่วยงานจริงไม่ควรขอ OTP/ข้อมูลบัตรผ่าน SMS ลิงก์สุ่ม",
    signals: ["อ้างเงินคืน/ผลประโยชน์", "ขอ OTP/ข้อมูลบัตร"],
  },
  {
    stem: "คุณได้รับ DM ในโซเชียลจากเพื่อน บอกว่า “ช่วยโหวตให้หน่อย” พร้อมลิงก์ คุณควรทำอะไรเป็นอันดับแรก?",
    options: [
      { text: "ทักถามเพื่อนด้วยช่องทางอื่น (โทร/ไลน์) ว่าเขาส่งจริงไหม", explanation: "บัญชีเพื่อนอาจถูกแฮก", isCorrect: true },
      { text: "กดลิงก์ทันที เพราะมาจากเพื่อน", explanation: "บัญชีเพื่อนอาจโดนยึดและส่งลิงก์มัลแวร์", isCorrect: false },
      { text: "แชร์ลิงก์ต่อเพื่อให้คนอื่นโหวตด้วย", explanation: "กระจายความเสี่ยงให้คนอื่น", isCorrect: false },
      { text: "ล็อกเอาต์ทุกบัญชี แล้วค่อยกดลิงก์", explanation: "ไม่ช่วยถ้าลิงก์เป็นเว็บปลอม/มัลแวร์", isCorrect: false },
    ],
    whyCorrect: "ข้อความจากเพื่อนก็ปลอมได้ ให้ยืนยันตัวตนก่อนคลิก",
    signals: ["ลิงก์ใน DM", "ใช้ความไว้ใจจากคนรู้จัก"],
  },
  {
    stem: "มีอีเมลจาก “HR” ขอให้ดาวน์โหลดไฟล์แนบ .zip เพื่อดูสลิปเงินเดือน คุณควรทำอย่างไร?",
    options: [
      { text: "ไม่เปิดไฟล์แนบ และขอไฟล์ผ่านระบบ/พอร์ทัลบริษัทที่ใช้อยู่จริง", explanation: "ไฟล์ .zip เสี่ยงมัลแวร์สูง", isCorrect: true },
      { text: "แตกไฟล์ในมือถือ น่าจะปลอดภัยกว่า", explanation: "มือถือก็โดนมัลแวร์ได้", isCorrect: false },
      { text: "เปิดไฟล์ก่อน แล้วค่อยสแกนไวรัสทีหลัง", explanation: "สายเกินไป ถ้าโดนรันทันที", isCorrect: false },
      { text: "ส่งไฟล์ให้เพื่อนร่วมงานลองเปิดก่อน", explanation: "ทำให้คนอื่นเสี่ยงแทน", isCorrect: false },
    ],
    whyCorrect: "เอกสารเงินเดือนควรอยู่ในระบบทางการ ไม่ส่ง zip สุ่ม",
    signals: ["ไฟล์แนบ .zip", "ปลอมเป็นฝ่ายงานภายใน"],
  },
  {
    stem: "เว็บประกาศขายของบอกให้โอนมัดจำทันทีเพื่อ ‘ล็อกสินค้า’ และให้บัญชีชื่อบุคคล คุณควรทำอย่างไร?",
    options: [
      { text: "ใช้ระบบชำระเงินในแพลตฟอร์ม/เก็บเงินปลายทาง และหลีกเลี่ยงโอนตรง", explanation: "ลดโอกาสโดนโกง", isCorrect: true },
      { text: "โอนมัดจำเล็กน้อยก่อนเพื่อกันพลาด", explanation: "มัดจำคือเหยื่อล่อให้โอนซ้ำ", isCorrect: false },
      { text: "ขอส่วนลดเพิ่มแล้วค่อยโอน", explanation: "ยังคงเสี่ยงเหมือนเดิม", isCorrect: false },
      { text: "ให้เขาส่งรูปบัตรประชาชนมาก็พอ", explanation: "เอกสารปลอมได้ และไม่ใช่หลักประกัน", isCorrect: false },
    ],
    whyCorrect: "การโอนตรงทำให้ตามเงินยาก ใช้ระบบคุ้มครองผู้ซื้อดีที่สุด",
    signals: ["เร่งให้โอนทันที", "บัญชีบุคคล/นอกระบบ"],
  },
  // ---- เติมให้ครบ 20 (เน้นหลากหลายธีม) ----
  {
    stem: "คุณได้สายโทรอ้างว่าเป็นธนาคาร ขอ OTP เพื่อ “ยกเลิกธุรกรรมต้องสงสัย” คุณควรทำอย่างไร?",
    options: [
      { text: "วางสาย แล้วโทรกลับเบอร์ธนาคารจากหลังบัตร/แอปเอง", explanation: "ยืนยันตัวตนผ่านช่องทางที่คุณควบคุม", isCorrect: true },
      { text: "ให้ OTP เพราะเขาช่วยยกเลิกให้", explanation: "OTP ใช้ยึดบัญชีได้", isCorrect: false },
      { text: "ถามชื่อพนักงานแล้วให้ OTP", explanation: "รู้ชื่อไม่ช่วยอะไร", isCorrect: false },
      { text: "บอกเลขบัตรก่อน แต่ไม่ให้ OTP", explanation: "ข้อมูลบัตรก็อันตราย", isCorrect: false },
    ],
    whyCorrect: "ธนาคารจริงจะไม่ขอ OTP ทางโทรศัพท์ ให้ยืนยันโดยโทรกลับเอง",
    signals: ["อ้างธนาคาร", "ขอ OTP ทางโทรศัพท์"],
  },
  {
    stem: "คุณเห็นโฆษณา “รับงานพาร์ทไทม์ กดไลก์ได้เงินทันที” ขอให้แอดไลน์และโอนค่ายืนยัน คุณควรเลือกข้อใด?",
    options: [
      { text: "ไม่โอนเงิน/ไม่ให้ข้อมูล และตรวจสอบบริษัท/ประกาศงานจากแหล่งน่าเชื่อถือ", explanation: "งานจริงไม่เก็บค่ายืนยัน", isCorrect: true },
      { text: "โอนนิดหน่อยเพราะบอกว่าจะคืน", explanation: "เข้าทางมิจฉาชีพ", isCorrect: false },
      { text: "ส่งบัตรประชาชนให้ก่อนเพื่อสมัครงาน", explanation: "เสี่ยงถูกสวมสิทธิ์", isCorrect: false },
      { text: "ลองทำ 1 วันก่อนแล้วค่อยคิด", explanation: "มักโดนหลอกให้โอนเพิ่ม", isCorrect: false },
    ],
    whyCorrect: "งานจริงไม่เรียกเก็บเงินสมัคร/ค่ายืนยัน",
    signals: ["สัญญาเงินง่ายๆ", "ให้โอนค่ายืนยัน"],
  },
  {
    stem: "มีอีเมลแจ้งว่า “กล่องเมลเต็ม” ให้ล็อกอินผ่านลิงก์เพื่อเพิ่มพื้นที่ คุณควรทำอะไร?",
    options: [
      { text: "เข้าอีเมลผ่านเว็บ/แอปที่ใช้ปกติ แล้วเช็คพื้นที่จากการตั้งค่า", explanation: "กันเว็บฟิชชิง", isCorrect: true },
      { text: "กดลิงก์แล้วล็อกอินเร็วๆ", explanation: "เสี่ยงโดนขโมยบัญชี", isCorrect: false },
      { text: "ตอบอีเมลขอเพิ่มพื้นที่", explanation: "ไม่ใช่วิธีทางการ", isCorrect: false },
      { text: "ส่งรหัสผ่านให้เพื่อให้เขาจัดการ", explanation: "ห้ามให้รหัสผ่านกับใคร", isCorrect: false },
    ],
    whyCorrect: "เรื่องพื้นที่อีเมลตรวจได้เองในระบบจริง ไม่ต้องล็อกอินผ่านลิงก์",
    signals: ["ให้ล็อกอินผ่านลิงก์", "อ้างปัญหาเร่งด่วน"],
  },
  {
    stem: "มี SMS บอกว่า “แพ็กเกจมือถือจะหมด” ให้กดลิงก์เพื่อยืนยันบัตร คุณควรทำอย่างไร?",
    options: [
      { text: "เช็คแพ็กเกจในแอปผู้ให้บริการหรือกด *123# ตามที่เคยใช้", explanation: "ใช้ช่องทางทางการ", isCorrect: true },
      { text: "กดลิงก์เพราะเป็นเรื่องมือถือ", explanation: "ลิงก์ปลอมได้", isCorrect: false },
      { text: "ส่งเลขบัตรให้เพื่อยืนยัน", explanation: "ข้อมูลส่วนตัวไม่ควรส่ง", isCorrect: false },
      { text: "จ่ายผ่านลิงก์เพราะแค่ 19 บาท", explanation: "ยอดน้อยคือเหยื่อล่อ", isCorrect: false },
    ],
    whyCorrect: "ตรวจสอบบริการมือถือควรทำในแอป/USSD ทางการ",
    signals: ["ลิงก์ใน SMS", "ให้ยืนยันบัตร/จ่ายเงินเล็กน้อย"],
  },
  {
    stem: "อีเมลแจ้งว่า “มีใบแจ้งหนี้ค้างชำระ” แต่คุณไม่ได้สั่งซื้ออะไรเลย คุณควรทำอย่างไร?",
    options: [
      { text: "อย่าคลิกลิงก์/ไฟล์แนบ และตรวจในบัญชีผู้ขาย/ติดต่อช่องทางทางการ", explanation: "กันมัลแวร์/ฟิชชิง", isCorrect: true },
      { text: "รีบโอนเพื่อปิดบิล", explanation: "เข้าทางมิจฉาชีพ", isCorrect: false },
      { text: "ดาวน์โหลดใบแจ้งหนี้มาเปิดดู", explanation: "ไฟล์อาจมีมัลแวร์", isCorrect: false },
      { text: "ส่งข้อมูลส่วนตัวเพื่อให้ยกเลิก", explanation: "ไม่จำเป็นและเสี่ยง", isCorrect: false },
    ],
    whyCorrect: "ใบแจ้งหนี้สุ่มคือเทคนิคหลอกให้คลิกไฟล์/ลิงก์",
    signals: ["ใบแจ้งหนี้ไม่คุ้น", "มีไฟล์แนบ/ลิงก์ให้เปิด"],
  },
  // เติมอีก 10 ข้อให้ครบ 20
  {
    stem: "มีคนส่งลิงก์ “ดูรูปคุณในงานเมื่อวาน” ในกลุ่มแชท คุณควรทำอย่างไร?",
    options: [
      { text: "ถามคนในกลุ่ม/เจ้าของลิงก์ว่ามาจากไหน และเปิดผ่านอุปกรณ์ที่ปลอดภัยหลังยืนยัน", explanation: "ลดความเสี่ยงลิงก์อันตราย", isCorrect: true },
      { text: "กดทันทีเพราะอยากรู้", explanation: "ลิงก์แนวนี้มักล่อให้ล็อกอิน/โหลดไฟล์", isCorrect: false },
      { text: "ส่งต่อไปอีกกลุ่มให้คนช่วยดู", explanation: "กระจายความเสี่ยง", isCorrect: false },
      { text: "ใส่รหัสผ่านถ้าถามก็ใส่ไป", explanation: "เสี่ยงโดนขโมยบัญชี", isCorrect: false },
    ],
    whyCorrect: "ลิงก์ที่เล่นกับความอยากรู้อยากเห็นต้องยืนยันก่อนเสมอ",
    signals: ["ลิงก์ชวนกด", "ใช้เหยื่อล่อทางอารมณ์"],
  },
  {
    stem: "อีเมลจาก ‘ทีมความปลอดภัย’ ขอให้คุณเปิด 2FA โดยให้กรอกโค้ดในฟอร์มลิงก์ คุณควรทำอย่างไร?",
    options: [
      { text: "เปิด 2FA ผ่านหน้าตั้งค่าบัญชีจริง ไม่กรอกโค้ดในฟอร์มลิงก์", explanation: "2FA ต้องตั้งจากระบบจริงเท่านั้น", isCorrect: true },
      { text: "กรอกโค้ดเพื่อเปิด 2FA", explanation: "อาจเป็นฟอร์มขโมยโค้ด/รหัส", isCorrect: false },
      { text: "ส่งโค้ดให้เขาทางอีเมลแทน", explanation: "ยิ่งอันตราย", isCorrect: false },
      { text: "ปิด 2FA ไปเลยจะได้ไม่ยุ่ง", explanation: "ทำให้บัญชีเสี่ยงขึ้น", isCorrect: false },
    ],
    whyCorrect: "ตั้งค่า Security ต้องทำในแอป/เว็บทางการ ไม่ผ่านฟอร์มแปลก",
    signals: ["ให้กรอกโค้ดผ่านลิงก์", "ปลอมเป็นทีมความปลอดภัย"],
  },
  {
    stem: "คุณได้ข้อความว่า “บัญชีถูกล็อกเพราะพยายามเข้าระบบหลายครั้ง” ให้กดลิงก์ปลดล็อก คุณควรทำอย่างไร?",
    options: [
      { text: "เข้าเว็บ/แอปจริงแล้วกด ‘ลืมรหัสผ่าน’ ด้วยตัวเอง", explanation: "ปลอดภัยกว่าคลิกลิงก์", isCorrect: true },
      { text: "กดลิงก์ปลดล็อกทันที", explanation: "มักพาไปเว็บปลอม", isCorrect: false },
      { text: "ส่งรหัสผ่านให้เพื่อปลดล็อก", explanation: "ห้ามให้รหัสผ่าน", isCorrect: false },
      { text: "ไม่ต้องทำอะไรเลยก็ได้", explanation: "ควรตรวจสอบความปลอดภัยผ่านช่องทางจริง", isCorrect: false },
    ],
    whyCorrect: "ปลดล็อก/รีเซ็ตควรทำเองในระบบจริงเสมอ",
    signals: ["อ้างบัญชีถูกล็อก", "ให้กดลิงก์ปลดล็อก"],
  },
  {
    stem: "มีอีเมลแจ้ง ‘ผู้จัดการส่งเอกสารลับ’ พร้อมลิงก์ Google Drive แต่ชื่อไฟล์แปลกๆ คุณควรทำอย่างไร?",
    options: [
      { text: "ยืนยันกับผู้จัดการ/ทีมงานทางช่องทางอื่นก่อนเปิด", explanation: "บัญชีอีเมลอาจถูกปลอม", isCorrect: true },
      { text: "เปิดทันทีเพราะมาจากผู้จัดการ", explanation: "อาจเป็นฟิชชิงเลียนแบบ", isCorrect: false },
      { text: "ดาวน์โหลดไฟล์แล้วค่อยสแกน", explanation: "บางไฟล์อันตรายตั้งแต่เปิด", isCorrect: false },
      { text: "ส่งลิงก์ให้คนอื่นช่วยดู", explanation: "ทำให้คนอื่นเสี่ยง", isCorrect: false },
    ],
    whyCorrect: "งานเอกสารลับต้องยืนยันตัวตนผู้ส่งเสมอ",
    signals: ["อ้างความลับ/เร่ง", "ลิงก์แชร์ไฟล์ที่ไม่น่าไว้ใจ"],
  },
  {
    stem: "SMS บอกว่า ‘คุณได้แต้มสะสม’ ให้กดลิงก์แลกของรางวัล แต่ URL แปลก คุณควรทำอย่างไร?",
    options: [
      { text: "เข้าแอป/เว็บของร้านนั้นเองแล้วเช็คแต้ม", explanation: "กันเว็บปลอม", isCorrect: true },
      { text: "กดลิงก์เพราะอยากได้ของรางวัล", explanation: "ของฟรีคือเหยื่อล่อ", isCorrect: false },
      { text: "กรอกข้อมูลที่อยู่เพื่อส่งของ", explanation: "เสี่ยงข้อมูลรั่ว", isCorrect: false },
      { text: "ส่ง OTP เพื่อยืนยันรับรางวัล", explanation: "OTP ห้ามให้ใคร", isCorrect: false },
    ],
    whyCorrect: "แต้มสะสมตรวจได้ในระบบจริง ของรางวัลจากลิงก์แปลกเสี่ยงสูง",
    signals: ["ล่อด้วยรางวัล", "URL แปลก/ลิงก์ใน SMS"],
  },
  {
    stem: "มีคนโทรมาบอกว่าเป็น ‘ขนส่ง’ ขอให้คุณบอกเลขบัตรเพื่อคืนเงินค่าส่ง คุณควรทำอย่างไร?",
    options: [
      { text: "ปฏิเสธให้ข้อมูล และติดต่อขนส่งจากช่องทางทางการเอง", explanation: "ขนส่งไม่ควรขอเลขบัตรทางโทรศัพท์", isCorrect: true },
      { text: "ให้เลขบัตรเพราะจะคืนเงิน", explanation: "เสี่ยงถูกดูดเงิน", isCorrect: false },
      { text: "ให้ OTP เพื่อคืนเงินเร็วขึ้น", explanation: "ยิ่งอันตราย", isCorrect: false },
      { text: "ให้เลขหลังบัตรแต่ไม่ให้เลขหน้า", explanation: "ก็ยังเสี่ยง", isCorrect: false },
    ],
    whyCorrect: "การคืนเงินทำผ่านระบบทางการ ไม่ขอข้อมูลบัตร/OTP ทางโทร",
    signals: ["อ้างคืนเงิน", "ขอข้อมูลบัตร/OTP"],
  },
  {
    stem: "คุณได้รับอีเมล ‘ยืนยันการจองโรงแรม’ แต่คุณไม่ได้จอง และมีปุ่ม “Cancel booking” คุณควรทำอย่างไร?",
    options: [
      { text: "อย่ากดปุ่ม และเข้าเว็บผู้ให้บริการจริงเพื่อตรวจรายการจอง", explanation: "ปุ่มยกเลิกอาจเป็นลิงก์ฟิชชิง", isCorrect: true },
      { text: "กด Cancel ทันทีเพื่อกันโดนตัดเงิน", explanation: "เข้าทางเว็บปลอม", isCorrect: false },
      { text: "ตอบกลับอีเมลถามรายละเอียด", explanation: "ยืนยันว่าบัญชีใช้งานได้", isCorrect: false },
      { text: "กรอกข้อมูลบัตรเพื่อยืนยันยกเลิก", explanation: "การยกเลิกไม่ควรขอบัตรแบบนี้", isCorrect: false },
    ],
    whyCorrect: "อีเมลจองปลอมใช้หลอกให้คลิกปุ่ม/กรอกข้อมูล",
    signals: ["คุณไม่ได้ทำรายการ", "มีปุ่มให้คลิกด่วน"],
  },
  {
    stem: "แชทใน marketplace บอกให้คุณออกไปคุยใน LINE และส่งลิงก์ ‘ชำระเงิน’ คุณควรทำอย่างไร?",
    options: [
      { text: "คุย/จ่ายในแพลตฟอร์มเท่านั้น และปฏิเสธออกไปนอกระบบ", explanation: "นอกระบบไม่มีการคุ้มครอง", isCorrect: true },
      { text: "ย้ายไปไลน์เพราะสะดวก", explanation: "เสี่ยงโดนส่งลิงก์ปลอม", isCorrect: false },
      { text: "กดลิงก์จ่ายเงินแล้วค่อยกลับมา", explanation: "อาจโดนขโมยข้อมูลการเงิน", isCorrect: false },
      { text: "ส่งเลขบัญชีให้เขาโอนกลับ", explanation: "ไม่เกี่ยวและเสี่ยงข้อมูลรั่ว", isCorrect: false },
    ],
    whyCorrect: "กลโกงยอดฮิตคือพาออกนอกระบบแล้วส่งลิงก์ปลอม",
    signals: ["ชวนออกนอกแพลตฟอร์ม", "ส่งลิงก์ชำระเงิน"],
  },
  {
    stem: "คุณได้อีเมลว่า ‘มีคนพยายามล็อกอินจากต่างประเทศ’ พร้อมลิงก์ “Secure account” คุณควรทำอย่างไร?",
    options: [
      { text: "เข้าแอป/เว็บจริง แล้วเปลี่ยนรหัสผ่าน/ดูอุปกรณ์ที่ล็อกอิน", explanation: "ทำผ่านระบบจริงปลอดภัยกว่า", isCorrect: true },
      { text: "กด Secure account ในอีเมล", explanation: "อาจเป็นเว็บปลอมเลียนแบบ", isCorrect: false },
      { text: "ส่งรหัสผ่านใหม่ให้เขายืนยัน", explanation: "ห้ามส่งรหัสผ่าน", isCorrect: false },
      { text: "ไม่ต้องทำอะไร เดี๋ยวก็หาย", explanation: "ควรตรวจและป้องกันทันทีผ่านช่องทางจริง", isCorrect: false },
    ],
    whyCorrect: "แจ้งเตือนล็อกอินปลอมมักหลอกให้กดลิงก์ ให้จัดการในระบบจริง",
    signals: ["แจ้งเตือนล็อกอินน่าสงสัย", "มีลิงก์ให้คลิกแก้ไข"],
  },
  {
    stem: "SMS บอกว่า ‘คะแนนสอบ/ผลสมัครงานออกแล้ว’ ให้กดลิงก์ดูผล คุณควรทำอย่างไร?",
    options: [
      { text: "เข้าเว็บหน่วยงาน/บริษัทจริง แล้วดูประกาศด้วยตัวเอง", explanation: "กันเว็บปลอม", isCorrect: true },
      { text: "กดลิงก์ทันทีเพราะอยากรู้ผล", explanation: "ใช้ความอยากรู้อยากเห็นล่อคลิก", isCorrect: false },
      { text: "กรอกข้อมูลส่วนตัวเพื่อดูผล", explanation: "เสี่ยงข้อมูลรั่ว", isCorrect: false },
      { text: "ส่งลิงก์ให้เพื่อนช่วยเช็ค", explanation: "ทำให้คนอื่นเสี่ยง", isCorrect: false },
    ],
    whyCorrect: "ประกาศผลสำคัญควรเช็คจากเว็บทางการที่คุณเข้าด้วยตัวเอง",
    signals: ["ลิงก์ใน SMS", "ใช้ความอยากรู้เป็นเหยื่อ"],
  },
  {
    stem: "อีเมลแจ้ง ‘อัปเดตระบบบัญชี’ ให้ดาวน์โหลดไฟล์ .exe คุณควรทำอย่างไร?",
    options: [
      { text: "ห้ามดาวน์โหลด/รันไฟล์ และตรวจสอบกับฝ่าย IT/เว็บทางการ", explanation: "ไฟล์ .exe เสี่ยงมัลแวร์สูง", isCorrect: true },
      { text: "ดาวน์โหลดแต่ไม่รันก็พอ", explanation: "แค่ดาวน์โหลดก็เสี่ยงต่อการเผลอเปิด/โดนสแกนไม่ทัน", isCorrect: false },
      { text: "รันในเครื่องเพื่อนแทน", explanation: "ทำให้คนอื่นโดนแทน", isCorrect: false },
      { text: "ปิดแอนตี้ไวรัสก่อนรันจะได้ไม่เด้ง", explanation: "อันตรายสุด", isCorrect: false },
    ],
    whyCorrect: "ไฟล์รันโปรแกรมจากอีเมลสุ่มคือสัญญาณมัลแวร์ชัดเจน",
    signals: ["ไฟล์ .exe", "อ้างอัปเดตระบบ"],
  },
  {
    stem: "คุณเห็นเว็บขึ้นหน้าต่าง ‘เครื่องติดไวรัส’ ให้โทรเบอร์ที่ให้มา คุณควรทำอย่างไร?",
    options: [
      { text: "ปิดหน้าเว็บ ไม่โทร และสแกนเครื่องด้วยโปรแกรมที่เชื่อถือได้/ขอ IT ช่วย", explanation: "tech support scam พบบ่อย", isCorrect: true },
      { text: "โทรทันทีเพราะกลัวข้อมูลหาย", explanation: "มิจฉาชีพจะหลอกติดตั้งโปรแกรมควบคุมเครื่อง", isCorrect: false },
      { text: "จ่ายเงินเพื่อปลดล็อก", explanation: "เสียเงินฟรีและยังเสี่ยงโดนต่อ", isCorrect: false },
      { text: "ให้เขารีโมทเครื่องเพื่อแก้ไวรัส", explanation: "โดนยึดเครื่อง/ข้อมูลได้", isCorrect: false },
    ],
    whyCorrect: "ป๊อปอัปหลอกให้โทรคือมุก scam คลาสสิก อย่าให้รีโมทเครื่อง",
    signals: ["ป๊อปอัปข่มขู่", "ให้โทร/ให้รีโมทเครื่อง"],
  },
  {
    stem: "อีเมลจาก ‘ธนาคาร’ แต่ที่อยู่อีเมลลงท้ายแปลกๆ และมีลิงก์สั้น คุณควรทำอย่างไร?",
    options: [
      { text: "ไม่คลิกลิงก์ และเข้าแอปธนาคารเองเพื่อตรวจรายการ", explanation: "ปลอดภัยและเช็คได้จริง", isCorrect: true },
      { text: "กดลิงก์เพราะมีโลโก้ธนาคาร", explanation: "โลโก้ปลอมได้ง่าย", isCorrect: false },
      { text: "ตอบกลับถามว่าโดเมนอะไร", explanation: "ไม่ช่วย แถมยืนยันว่าคุณอ่าน", isCorrect: false },
      { text: "ส่งเลขบัตรเพื่อให้ตรวจสอบ", explanation: "ข้อมูลบัตรไม่ควรส่ง", isCorrect: false },
    ],
    whyCorrect: "ธนาคารตรวจได้ในแอปเสมอ อย่าเชื่ออีเมล/ลิงก์แปลก",
    signals: ["โดเมนผู้ส่งแปลก", "ลิงก์สั้น/ไม่ทางการ"],
  },
];

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // ✅ เลือกข้อจาก answered (ยืนยันแล้วกี่ข้อ) -> วน 20 ข้อ
  const answered = Number(body?.answered ?? 0);
  const idx = Number.isFinite(answered) && answered >= 0 ? answered % QUIZ_BANK.length : 0;

  const item = QUIZ_BANK[idx];
  const parsed = QuizBankItemSchema.safeParse(item);

  // กันพัง: ถ้า bank เผลอผิด format
  if (!parsed.success) {
    const fallback = QUIZ_BANK[0];
    return NextResponse.json({ quiz: buildOut(fallback) });
  }

  return NextResponse.json({ quiz: buildOut(parsed.data) });
}
