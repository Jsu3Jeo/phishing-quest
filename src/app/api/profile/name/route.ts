import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromRequest, signSession, getSessionCookieName } from "@/lib/auth";
import type { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const displayName = (body?.displayName || "").toString().trim();

  if (!displayName || displayName.length < 2 || displayName.length > 20) {
    return NextResponse.json({ error: "ชื่อต้องยาว 2–20 ตัวอักษร" }, { status: 400 });
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.sub },
      data: { displayName },
      select: { id: true, email: true, displayName: true },
    });

    const token = await signSession({ sub: user.id, email: user.email, displayName: user.displayName });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return res;
  } catch (e: any) {
    // Prisma unique constraint
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "ชื่อนี้มีคนใช้แล้ว (ต้องไม่ซ้ำใน Scoreboard)" }, { status: 409 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาด" }, { status: 500 });
  }
}
