// src/app/api/accounts/route.ts
// GET /api/accounts — list all accounts
// POST /api/accounts — add a new account

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, created, handleApiError } from "@/lib/api/response";
import {
  listAccounts,
  addAccount,
} from "@/lib/services/account-service";
import { createAccountSchema } from "@/lib/validations/account";
import { sanitizeAccount } from "@/lib/api/serialize";

export const GET = withAuth(async () => {
  try {
    const accounts = await listAccounts();
    return success(accounts);
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = createAccountSchema.safeParse(body);

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { ok: false, error: issues },
        { status: 400 }
      );
    }

    const account = await addAccount(parsed.data);
    return created(sanitizeAccount(account as Record<string, unknown>));
  } catch (error) {
    return handleApiError(error);
  }
});
