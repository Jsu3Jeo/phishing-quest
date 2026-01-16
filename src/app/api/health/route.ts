import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.user.count(); // ถ้า DB/Prisma มีปัญหา จะ throw ตรงนี้
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "db error" },
      { status: 500 }
    );
  }
}