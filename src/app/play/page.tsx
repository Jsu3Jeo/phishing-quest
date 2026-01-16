import Link from "next/link";

export default function PlaySelectPage() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">เลือกโหมดการเล่น</h1>
        <p className="mt-1 text-sm text-white/70">
          เลือกโหมดที่อยากฝึก (Inbox Mode ได้คะแนนมากกว่า)
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/game"
          className="rounded-2xl border border-white/10 bg-white/5 p-6 hover:bg-white/10 transition"
        >
          <div className="text-xs uppercase tracking-widest text-white/60">
            Mode
          </div>
          <div className="mt-2 text-xl font-semibold">โหมดปกติ (A/B/C/D)</div>
          <div className="mt-2 text-sm text-white/80">
            เลือกคำตอบ A B C D แล้วกดยืนยัน → ได้ <b>10</b> คะแนน/ข้อถูก
          </div>
          <div className="mt-4 text-sm text-white/70">
            เหมาะสำหรับ: ฝึกอ่านสัญญาณ phishing แบบเป็นระบบ
          </div>
        </Link>

        <Link
          href="/inbox"
          className="rounded-2xl border border-white/10 bg-white/5 p-6 hover:bg-white/10 transition"
        >
          <div className="text-xs uppercase tracking-widest text-white/60">
            Mode
          </div>
          <div className="mt-2 text-xl font-semibold">Inbox Mode (Legit หรือ Phishing)</div>
          <div className="mt-2 text-sm text-white/80">
            อ่าน “อีเมล/ข้อความ” เหมือนจริง แล้วตัดสินว่า Legit หรือ Phishing →
            ได้ <b>15</b> คะแนน/ข้อถูก
          </div>
          <div className="mt-4 text-sm text-white/70">
            เหมาะสำหรับ: คนแก่/เด็ก/มือใหม่ เพราะเหมือนสถานการณ์จริงมาก
          </div>
        </Link>
      </div>

      <div className="text-sm text-white/60">
        หมายเหตุ: คะแนนจากทุกโหมดจะรวมใน Scoreboard เดียวกัน
      </div>
    </div>
  );
}
