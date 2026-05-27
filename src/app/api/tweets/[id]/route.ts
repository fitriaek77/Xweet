// src/app/api/tweets/[id]/route.ts
// GET /api/tweets/:id — get tweet details
// PUT /api/tweets/:id — update tweet content/schedule
// DELETE /api/tweets/:id — remove tweet

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, handleApiError, noContent } from "@/lib/api/response";
import { getTweet, removeTweet } from "@/lib/services/tweet-service";
import { updateTweetSchema } from "@/lib/validations/tweet";
import { updateTweet as dbUpdateTweet } from "@/lib/db/queries/tweets";
import { sanitizeTweet } from "@/lib/api/serialize";
import { TWEET_STATUS } from "@/config/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    try {
      const { id } = await params;
      const tweet = await getTweet(id);
      // Strip internal fields (mediaKey) before sending to client
      return success(sanitizeTweet(tweet as Record<string, unknown>));
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
      const parsed = updateTweetSchema.safeParse(body);

      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return NextResponse.json(
          { ok: false, error: issues },
          { status: 400 }
        );
      }

      // If the tweet is X-scheduled, update it on X before updating the DB
      const existingTweet = await getTweet(id);

      if (existingTweet.status === TWEET_STATUS.X_SCHEDULED && existingTweet.scheduledTweetRestId) {
        // Tweet is X-scheduled — must update both X and DB
        if (parsed.data.content || parsed.data.scheduledAt) {
          const { decryptCookies } = await import("@/lib/services/encryption-service");
          const { parseCookieString } = await import("@/lib/twitter/ct0-refresh");
          const { editScheduledTweet } = await import("@/lib/twitter/scheduled-tweet");

          const cookies = await decryptCookies(existingTweet.accountId);
          if (cookies) {
            const parsedCookies = parseCookieString(cookies);
            if (parsedCookies) {
              await editScheduledTweet({
                cookies,
                ct0: parsedCookies.ct0,
                scheduledTweetRestId: existingTweet.scheduledTweetRestId,
                text: parsed.data.content ?? existingTweet.content,
                executeAt: parsed.data.scheduledAt
                  ? Math.floor(new Date(parsed.data.scheduledAt).getTime() / 1000)
                  : Math.floor(existingTweet.scheduledAt.getTime() / 1000),
              });
            }
          }
        }
      }

      const data: Record<string, unknown> = {};
      if (parsed.data.content) data.content = parsed.data.content;
      if (parsed.data.scheduledAt) {
        data.scheduledAt = new Date(parsed.data.scheduledAt);
      }
      if (parsed.data.status === "cancelled") data.status = "cancelled";

      const tweet = await dbUpdateTweet(id, data);
      // Strip internal fields before sending to client
      return success(sanitizeTweet(tweet as Record<string, unknown>));
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
      await removeTweet(id);
      return noContent();
    } catch (error) {
      return handleApiError(error);
    }
  })(_req, undefined);
}
