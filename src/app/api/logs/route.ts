// src/app/api/logs/route.ts
// GET /api/logs — list audit log entries

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { getLogs } from "@/lib/db/queries/logs";

export async function GET(req: NextRequest) {
  return withAuth(async () => {
    try {
      const { searchParams } = new URL(req.url);
      const logs = await getLogs({
        tweetId: searchParams.get("tweetId") ?? undefined,
        accountId: searchParams.get("accountId") ?? undefined,
        action: searchParams.get("action") ?? undefined,
        limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
        offset: searchParams.get("offset") ? Number(searchParams.get("offset")) : undefined,
      });
      return success(logs);
    } catch (error) {
      return handleApiError(error);
    }
  })(req, undefined);
}
