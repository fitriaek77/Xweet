// src/app/api/tweets/[id]/post-now/route.ts
// POST /api/tweets/:id/post-now — manually trigger immediate posting (Layer 4)

import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { publishTweet } from "@/lib/services/tweet-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const result = await publishTweet(id, "manual");

      if (result.success) {
        return success({ tweetId: result.tweetId, posted: true });
      }

      return success({
        tweetId: result.tweetId,
        posted: false,
        error: result.error,
      });
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
