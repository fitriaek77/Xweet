// src/lib/api/proxy.ts
// Request proxy — replaces middleware.ts in Next.js 16+.
// withAuth: protects admin routes (checks session cookie against Session table).
// withCronSecret: verifies cron-job.org requests via shared secret.

import { type NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { getEnv } from "@/config/env";

type Handler = (req: NextRequest, ctx: unknown) => Promise<NextResponse>;

/**
 * Wrap an API route handler with admin authentication.
 * Returns 401 if no valid session cookie found or session is expired.
 */
export function withAuth(handler: Handler): Handler {
  return async (req, ctx) => {
    const session = await verifySession();

    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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
