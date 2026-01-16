import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const score = Number(body?.score ?? 0);
  const questionsCount = Number(body?.questionsCount ?? 0);

  if (!Number.isFinite(score) || score < 0 || score > 999) {
    return NextResponse.json({ error: "score ไม่ถูกต้อง" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.gameLog.create({
      data: {
        userId: session.sub,
        score,
        questionsCount: Math.max(0, Math.min(questionsCount, 200)),
      },
    });

    await tx.user.update({
      where: { id: session.sub },
      data: {
        totalScore: { increment: score },
        gamesPlayed: { increment: 1 },
      },
    });
  });

  return NextResponse.json({ ok: true });
}
