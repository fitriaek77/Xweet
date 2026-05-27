// src/app/api/accounts/[id]/verify/route.ts
// POST /api/accounts/:id/verify — verify account cookies via ct0 refresh

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { verifyAccount } from "@/lib/services/account-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const result = await verifyAccount(id);
      return success(result);
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
