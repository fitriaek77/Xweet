// GET /api/tweets — list tweets with filters
// POST /api/tweets — create a new scheduled tweet

import { type NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/proxy";
import { success, created, handleApiError } from "@/lib/api/response";
import { scheduleNewTweet, listTweets } from "@/lib/services/tweet-service";
import { createTweetSchema } from "@/lib/validations/tweet";
import { sanitizeTweets, sanitizeTweet } from "@/lib/api/serialize";

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const accountId = searchParams.get("accountId");
    const status = searchParams.get("status");
    const limit = limitParam ? Math.max(1, parseInt(limitParam, 10) || 50) : undefined;
    const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : undefined;

    const tweets = await listTweets({
      ...(accountId != null && { accountId }),
      ...(status != null && { status }),
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
    });
    // Strip internal fields (mediaKey) before sending to client
    return success(sanitizeTweets(tweets as Record<string, unknown>[]));
  } catch (error) {
    return handleApiError(error);
  }
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = createTweetSchema.safeParse(body);

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return NextResponse.json(
        { ok: false, error: issues },
        { status: 400 }
      );
    }

    const tweet = await scheduleNewTweet({
      accountId: parsed.data.accountId,
      content: parsed.data.content,
      scheduledAt: new Date(parsed.data.scheduledAt),
      mediaData: parsed.data.mediaBase64
        ? Buffer.from(parsed.data.mediaBase64, "base64")
        : undefined,
      mediaMimeType: parsed.data.mediaMimeType,
    });

    // Strip internal fields before sending to client
    return created(sanitizeTweet(tweet as Record<string, unknown>));
  } catch (error) {
    return handleApiError(error);
  }
});
