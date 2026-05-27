// src/app/api/accounts/[id]/reset-circuit/route.ts
// POST /api/accounts/:id/reset-circuit — manually close circuit breaker (admin action)

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { resetCircuit } from "@/lib/services/account-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      await resetCircuit(id);
      return success({ reset: true });
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
