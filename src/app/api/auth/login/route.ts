// POST /api/auth/login
import type { NextRequest } from "next/server";
import { success, unauthorized, handleApiError, badRequest } from "@/lib/api/response";
import { loginSchema } from "@/lib/validations/auth";
import { verifyPassword, generateSessionToken, hashToken } from "@/lib/auth/session";
import { adminExists, cleanExpiredSessions } from "@/lib/auth/dal";
import { db } from "@/lib/db/db";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from "@/lib/api/rate-limit";

export async function POST(req: NextRequest) {
  try {
    // ─── Rate limiting ───
    // Use the LAST entry in x-forwarded-for (set by our reverse proxy),
    // not the first (which can be spoofed by the client).
    const xff = req.headers.get("x-forwarded-for");
    const ip = (xff ? xff.split(",").pop()?.trim() : undefined)
      || req.headers.get("x-real-ip")
      || "unknown";

    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Too many login attempts. Please try again later.",
          retryAfterMs: rateCheck.retryAfterMs,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          },
        }
      );
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid input", parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { password } = parsed.data;
    const _env = getEnv();

    // First-time setup: no admin exists yet
    const hasAdmin = await adminExists();
    if (!hasAdmin) {
      // Create admin with the provided password
      const { hashPassword } = await import("@/lib/auth/session");
      const passwordHash = await hashPassword(password);
      await db.admin.create({ data: { passwordHash } });
    }

    // Verify password
    const admin = await db.admin.findFirst();
    if (!admin) {
      return unauthorized("No admin account found");
    }

    const valid = await verifyPassword(password, admin.passwordHash);
    if (!valid) {
      recordFailedAttempt(ip);
      return unauthorized("Invalid password");
    }

    // ─── Create session ───
    const token = generateSessionToken();
    const hash = await hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await db.session.create({
      data: {
        tokenHash: hash,
        adminId: admin.id,
        expiresAt,
      },
    });

    // Clean up expired sessions in the background
    cleanExpiredSessions().catch(() => {});

    // Reset rate limit on successful login
    resetRateLimit(ip);

    // Set HTTP-only cookie
    const response = success({ authenticated: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_MAX_AGE_MS / 1000,
      path: "/",
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
