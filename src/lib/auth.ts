import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "session";
const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-change-me");

export type SessionPayload = {
  sub: string; // userId
  email: string;
  displayName?: string | null;
};

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export async function signSession(payload: SessionPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret);
}

export async function readSessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await readSessionToken(token);
}

import "server-only";
import { cookies } from "next/headers";

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const jar = await cookies(); // ✅ ต้อง await
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await readSessionToken(token);
}
