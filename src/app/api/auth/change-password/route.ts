// POST /api/auth/change-password
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, badRequest, handleApiError, unauthorized } from "@/lib/api/response";
import { changePasswordSchema } from "@/lib/validations/auth";
import { verifyPassword, hashPassword } from "@/lib/auth/session";
import { db } from "@/lib/db/db";

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(
        "Invalid input",
        parsed.error.issues.map((i) => i.message).join(", ")
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    // Find admin
    const admin = await db.admin.findFirst();
    if (!admin) {
      return unauthorized("No admin account found");
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, admin.passwordHash);
    if (!valid) {
      return unauthorized("Current password is incorrect");
    }

    // Hash and update new password
    const newHash = await hashPassword(newPassword);
    await db.admin.update({
      where: { id: admin.id },
      data: { passwordHash: newHash },
    });

    // Invalidate all other sessions (keep current session alive for UX)
    const { cookies } = await import("next/headers");
    const { hashToken } = await import("@/lib/auth/session");
    const { SESSION_COOKIE_NAME } = await import("@/config/constants");
    const cookieStore = await cookies();
    const currentToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    let currentTokenHash: string | undefined;
    if (currentToken) {
      currentTokenHash = await hashToken(currentToken);
    }
    // Delete all sessions except the current one
    await db.session.deleteMany({
      where: {
        adminId: admin.id,
        ...(currentTokenHash && { NOT: { tokenHash: currentTokenHash } }),
      },
    });

    return success({ changed: true });
  } catch (error) {
    return handleApiError(error);
  }
});
