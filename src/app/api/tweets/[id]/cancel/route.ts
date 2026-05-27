// src/app/api/tweets/[id]/cancel/route.ts
// POST /api/tweets/:id/cancel — cancel a scheduled tweet

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError } from "@/lib/api/response";
import { cancelTweet, getTweet } from "@/lib/services/tweet-service";
import { TWEET_STATUS } from "@/config/constants";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;

      // Reject cancel if tweet is currently being sent
      const tweet = await getTweet(id);
      if (tweet.status === TWEET_STATUS.SENDING) {
        return NextResponse.json(
          { ok: false, error: "Cannot cancel a tweet that is currently being sent" },
          { status: 409 }
        );
      }

      await cancelTweet(id);
      return success({ cancelled: true });
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
