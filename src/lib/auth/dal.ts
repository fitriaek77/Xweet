// src/lib/auth/dal.ts
// Data Access Layer for authentication.
// Verifies session tokens against the dedicated Session table.

import { cookies } from "next/headers";
import { db } from "@/lib/db/db";
import { hashToken } from "./session";
import { SESSION_COOKIE_NAME } from "@/config/constants";
import { AuthError } from "@/lib/api/errors";

export interface Session {
  id: string;
  adminId: string;
}

/**
 * Verify the current session from cookies.
 * Queries the Session table and checks expiry.
 * Returns null if no valid session found.
 */
export async function verifySession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const hash = await hashToken(token);

  // Look up session by token hash in the dedicated Session table
  const session = await db.session.findUnique({
    where: { tokenHash: hash },
  });

  if (!session) return null;

  // Check if session has expired
  if (session.expiresAt < new Date()) {
    // Delete expired session and return null
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return { id: session.id, adminId: session.adminId };
}

/**
 * Require authentication — throws if no valid session.
 */
export async function requireAuth(): Promise<Session> {
  const session = await verifySession();
  if (!session) {
    throw new AuthError();
  }
  return session;
}

/**
 * Check if admin account exists (for first-time setup flow).
 */
export async function adminExists(): Promise<boolean> {
  const count = await db.admin.count();
  return count > 0;
}

/**
 * Clean up expired sessions from the database.
 * Call this periodically (e.g., on login or cron tick).
 */
export async function cleanExpiredSessions(): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
