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
 * Supports two sources:
 * 1. Vercel Cron: sends `Authorization: Bearer <CRON_SECRET>` header
 * 2. cron-job.org: sends `x-cron-secret` header
 */
export function withCronSecret(handler: Handler): Handler {
  return async (req, ctx) => {
    const env = getEnv();

    // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // cron-job.org sends x-cron-secret header
    const customSecret = req.headers.get("x-cron-secret");

    const providedSecret = bearerToken || customSecret;

    if (!providedSecret || providedSecret !== env.CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Invalid cron secret" }, { status: 403 });
    }

    return handler(req, ctx);
  };
}
