import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const top = await prisma.user.findMany({
    where: { displayName: { not: null } },
    orderBy: [{ totalScore: "desc" }, { gamesPlayed: "desc" }, { updatedAt: "desc" }],
    take: 50,
    select: { displayName: true, totalScore: true, gamesPlayed: true, updatedAt: true },
  });

  return NextResponse.json({ top });
}
