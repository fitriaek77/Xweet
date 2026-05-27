// src/app/api/accounts/[id]/refresh-ct0/route.ts
// POST /api/accounts/:id/refresh-ct0 — manually refresh ct0

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { refreshAccountCt0 } from "@/lib/services/account-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const result = await refreshAccountCt0(id);
      return success(result);
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
