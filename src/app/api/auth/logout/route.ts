// POST /api/auth/logout
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/config/constants";
import { db } from "@/lib/db/db";
import { hashToken } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  // Delete the session record from DB
  try {
    const cookieStore = req.cookies;
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (token) {
      const hash = await hashToken(token);
      await db.session.delete({ where: { tokenHash: hash } }).catch(() => {});
    }
  } catch {
    // Ignore errors — session may already be deleted
  }

  // Clear cookie
  const response = NextResponse.json({ ok: true, data: { loggedOut: true } });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });

  return response;
}
