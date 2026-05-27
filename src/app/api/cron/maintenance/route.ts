// src/app/api/cron/maintenance/route.ts
// POST /api/cron/maintenance — legacy route, now merged into tick.
// All maintenance tasks (ct0 refresh, X-schedule sync) are now part of
// the single cron tick at /api/cron/tick. This route redirects there.

import type { NextRequest } from "next/server";
import { withCronSecret } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { executeCronTick } from "@/lib/services/schedule-service";

export async function POST(req: NextRequest) {
  return withCronSecret(async () => {
    try {
      const result = await executeCronTick();
      return success(result);
    } catch (error) {
      return handleApiError(error);
    }
  })(req, undefined);
}
