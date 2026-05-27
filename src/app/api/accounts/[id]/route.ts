// src/app/api/accounts/[id]/route.ts
// GET /api/accounts/:id — get account details
// PUT /api/accounts/:id — update account
// DELETE /api/accounts/:id — remove account

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError, noContent } from "@/lib/api/response";
import {
  getAccount,
  modifyAccount,
  removeAccount,
} from "@/lib/services/account-service";
import { updateAccountSchema } from "@/lib/validations/account";
import { sanitizeAccount } from "@/lib/api/serialize";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const account = await getAccount(id);
      return success(sanitizeAccount(account as Record<string, unknown>));
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const body = await req.json();
      const parsed = updateAccountSchema.safeParse(body);

      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return NextResponse.json(
          { ok: false, error: issues },
          { status: 400 }
        );
      }

      const account = await modifyAccount(id, parsed.data);
      return success(sanitizeAccount(account as Record<string, unknown>));
    } catch (error) {
      return handleApiError(error);
    }
  })(req, undefined);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      await removeAccount(id);
      return noContent();
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
