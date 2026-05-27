// src/app/api/cron/tick/route.ts
// POST /api/cron/tick — cron-job.org dispatches every 5 min.
// Dispatches due tweets, recovers stale locks, retries failed tweets.

import { type NextRequest } from "next/server";
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
