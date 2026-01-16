import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, getSessionCookieName } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/api/auth/login",
  "/api/auth/signup",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // allow next internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const session = await getSessionFromRequest(req);

  // Public: ok
  if (isPublic) return NextResponse.next();

  // Not logged in -> login
  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Logged in but no displayName -> force /name (except name + api)
  const isNamePath = pathname === "/name" || pathname.startsWith("/api/profile/name") || pathname.startsWith("/api/me");
  if (!session.displayName && !isNamePath) {
    return NextResponse.redirect(new URL("/name", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
