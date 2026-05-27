// src/lib/api/proxy.ts
// Request proxy — replaces middleware.ts in Next.js 16+.
// withAuth: protects admin routes (checks session cookie against Session table).
// withCronSecret: verifies cron-job.org requests via shared secret.

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { hashToken } from "@/lib/auth/session";
import { getEnv } from "@/config/env";
import { SESSION_COOKIE_NAME } from "@/config/constants";

type Handler = (req: NextRequest, ctx: unknown) => Promise<NextResponse>;

/**
 * Wrap an API route handler with admin authentication.
 * Returns 401 if no valid session cookie found or session is expired.
 */
export function withAuth(handler: Handler): Handler {
  return async (req, ctx) => {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Verify session token against Session table
    const { db } = await import("@/lib/db/db");
    const hash = await hashToken(token);

    const session = await db.session.findUnique({
      where: { tokenHash: hash },
    });

    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Check if session has expired
    if (session.expiresAt < new Date()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
      return NextResponse.json({ ok: false, error: "Session expired" }, { status: 401 });
    }

    return handler(req, ctx);
  };
}

/**
 * Wrap an API route handler with cron secret verification.
 * cron-job.org sends x-cron-secret header on every request.
 */
export function withCronSecret(handler: Handler): Handler {
  return async (req, ctx) => {
    const env = getEnv();
    const secret = req.headers.get("x-cron-secret");

    if (!secret || secret !== env.CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Invalid cron secret" }, { status: 403 });
    }

    return handler(req, ctx);
  };
}
