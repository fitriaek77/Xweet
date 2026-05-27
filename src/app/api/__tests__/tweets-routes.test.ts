// Tests for /api/tweets routes: list, create, get, update, delete, cancel, post-now
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock withAuth as passthrough — bypasses auth for route testing
 
vi.mock("@/lib/api/proxy", () => ({
  withAuth: (fn: (...args: unknown[]) => unknown) => fn,
  withCronSecret: (fn: (...args: unknown[]) => unknown) => fn,
}));

// Mock tweet-service
const mockListTweets = vi.fn();
const mockScheduleNewTweet = vi.fn();
const mockGetTweet = vi.fn();
const mockRemoveTweet = vi.fn();
const mockCancelTweet = vi.fn();
const mockPublishTweet = vi.fn();

vi.mock("@/lib/services/tweet-service", () => ({
  listTweets: (...args: unknown[]) => mockListTweets(...args),
  scheduleNewTweet: (...args: unknown[]) => mockScheduleNewTweet(...args),
  getTweet: (...args: unknown[]) => mockGetTweet(...args),
  removeTweet: (...args: unknown[]) => mockRemoveTweet(...args),
  cancelTweet: (...args: unknown[]) => mockCancelTweet(...args),
  publishTweet: (...args: unknown[]) => mockPublishTweet(...args),
}));

// Mock @/lib/db/queries/tweets (used directly in PUT route)
const mockDbUpdateTweet = vi.fn();

vi.mock("@/lib/db/queries/tweets", () => ({
  updateTweet: (...args: unknown[]) => mockDbUpdateTweet(...args),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { GET as listGET, POST as listPOST } from "@/app/api/tweets/route";
import {
  GET as detailGET,
  PUT as detailPUT,
  DELETE as detailDELETE,
} from "@/app/api/tweets/[id]/route";
import { POST as cancelPOST } from "@/app/api/tweets/[id]/cancel/route";
import { POST as postNowPOST } from "@/app/api/tweets/[id]/post-now/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJsonRequest(body: unknown, url = "http://localhost/api/tweets"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/tweets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of tweets with no filters", async () => {
    const tweets = [
      { id: "t-1", content: "Hello", status: "scheduled" },
      { id: "t-2", content: "World", status: "sent" },
    ];
    mockListTweets.mockResolvedValue(tweets);

    const req = new NextRequest("http://localhost/api/tweets");
    const response = await listGET(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    // sanitizeTweets strips mediaKey and adds hasMedia
    expect(body.data).toEqual([
      { id: "t-1", content: "Hello", status: "scheduled", hasMedia: false },
      { id: "t-2", content: "World", status: "sent", hasMedia: false },
    ]);
  });

  it("passes accountId filter from query params", async () => {
    mockListTweets.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/tweets?accountId=acc-1");
    const response = await listGET(req, undefined);

    expect(response.status).toBe(200);
    expect(mockListTweets).toHaveBeenCalledWith({
      accountId: "acc-1",
      status: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it("passes status filter from query params", async () => {
    mockListTweets.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/tweets?status=scheduled");
    const response = await listGET(req, undefined);

    expect(response.status).toBe(200);
    expect(mockListTweets).toHaveBeenCalledWith({
      accountId: undefined,
      status: "scheduled",
      limit: undefined,
      offset: undefined,
    });
  });

  it("passes limit and offset from query params", async () => {
    mockListTweets.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/tweets?limit=10&offset=5");
    const response = await listGET(req, undefined);

    expect(response.status).toBe(200);
    expect(mockListTweets).toHaveBeenCalledWith({
      accountId: undefined,
      status: undefined,
      limit: 10,
      offset: 5,
    });
  });

  it("passes all filters combined", async () => {
    mockListTweets.mockResolvedValue([]);

    const req = new NextRequest(
      "http://localhost/api/tweets?accountId=acc-1&status=scheduled&limit=20&offset=10"
    );
    const response = await listGET(req, undefined);

    expect(response.status).toBe(200);
    expect(mockListTweets).toHaveBeenCalledWith({
      accountId: "acc-1",
      status: "scheduled",
      limit: 20,
      offset: 10,
    });
  });

  it("handles errors from listTweets", async () => {
    mockListTweets.mockRejectedValue(new Error("DB error"));

    const req = new NextRequest("http://localhost/api/tweets");
    const response = await listGET(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/tweets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a tweet with valid data", async () => {
    const newTweet = { id: "t-1", content: "Hello world", status: "scheduled" };
    mockScheduleNewTweet.mockResolvedValue(newTweet);

    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "Hello world",
      scheduledAt: "2025-12-31T12:00:00Z",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ id: "t-1", content: "Hello world", status: "scheduled", hasMedia: false });
  });

  it("calls scheduleNewTweet with correct parsed data", async () => {
    mockScheduleNewTweet.mockResolvedValue({ id: "t-1" });

    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "Hello world",
      scheduledAt: "2025-12-31T12:00:00Z",
    });
    await listPOST(req, undefined);

    expect(mockScheduleNewTweet).toHaveBeenCalledWith({
      accountId: "acc-1",
      content: "Hello world",
      scheduledAt: new Date("2025-12-31T12:00:00Z"),
      mediaData: undefined,
      mediaMimeType: undefined,
    });
  });

  it("passes media data when provided", async () => {
    mockScheduleNewTweet.mockResolvedValue({ id: "t-1" });

    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "Tweet with image",
      scheduledAt: "2025-12-31T12:00:00Z",
      mediaBase64: "aGVsbG8=",
      mediaMimeType: "image/png",
    });
    await listPOST(req, undefined);

    expect(mockScheduleNewTweet).toHaveBeenCalledWith({
      accountId: "acc-1",
      content: "Tweet with image",
      scheduledAt: new Date("2025-12-31T12:00:00Z"),
      mediaData: Buffer.from("aGVsbG8=", "base64"),
      mediaMimeType: "image/png",
    });
  });

  it("returns 400 when accountId is missing", async () => {
    const req = makeJsonRequest({
      content: "Hello world",
      scheduledAt: "2025-12-31T12:00:00Z",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("accountId");
  });

  it("returns 400 when content is missing", async () => {
    const req = makeJsonRequest({
      accountId: "acc-1",
      scheduledAt: "2025-12-31T12:00:00Z",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("content");
  });

  it("returns 400 when content exceeds 280 characters", async () => {
    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "a".repeat(281),
      scheduledAt: "2025-12-31T12:00:00Z",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 400 when scheduledAt is invalid", async () => {
    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "Hello world",
      scheduledAt: "not-a-date",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 400 when mediaMimeType is unsupported", async () => {
    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "Hello world",
      scheduledAt: "2025-12-31T12:00:00Z",
      mediaBase64: "aGVsbG8=",
      mediaMimeType: "text/plain",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("handles errors from scheduleNewTweet", async () => {
    mockScheduleNewTweet.mockRejectedValue(new Error("DB error"));

    const req = makeJsonRequest({
      accountId: "acc-1",
      content: "Hello world",
      scheduledAt: "2025-12-31T12:00:00Z",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/tweets/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tweet details", async () => {
    const tweet = { id: "t-1", content: "Hello", status: "scheduled" };
    mockGetTweet.mockResolvedValue(tweet);

    const req = new NextRequest("http://localhost/api/tweets/t-1");
    const response = await detailGET(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ id: "t-1", content: "Hello", status: "scheduled", hasMedia: false });
    expect(mockGetTweet).toHaveBeenCalledWith("t-1");
  });

  it("handles NotFoundError from getTweet", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockGetTweet.mockRejectedValue(new NotFoundError("Tweet", "t-1"));

    const req = new NextRequest("http://localhost/api/tweets/t-1");
    const response = await detailGET(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("PUT /api/tweets/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getTweet returns a scheduled tweet (not X-scheduled)
    // so the PUT route skips the X-schedule edit path
    mockGetTweet.mockResolvedValue({
      id: "t-1",
      content: "Hello",
      status: "scheduled",
      accountId: "acct-1",
      scheduledAt: new Date("2025-01-01T12:00:00Z"),
      scheduledTweetRestId: null,
    });
  });

  it("updates tweet content", async () => {
    const updatedTweet = { id: "t-1", content: "Updated content" };
    mockDbUpdateTweet.mockResolvedValue(updatedTweet);

    const req = makeJsonRequest(
      { content: "Updated content" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ id: "t-1", content: "Updated content", hasMedia: false });
    expect(mockDbUpdateTweet).toHaveBeenCalledWith("t-1", {
      content: "Updated content",
    });
  });

  it("updates tweet scheduledAt", async () => {
    mockDbUpdateTweet.mockResolvedValue({ id: "t-1" });

    const req = makeJsonRequest(
      { scheduledAt: "2026-01-01T00:00:00Z" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));

    expect(response.status).toBe(200);
    expect(mockDbUpdateTweet).toHaveBeenCalledWith("t-1", {
      scheduledAt: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("updates tweet status to cancelled", async () => {
    mockDbUpdateTweet.mockResolvedValue({ id: "t-1" });

    const req = makeJsonRequest(
      { status: "cancelled" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));

    expect(response.status).toBe(200);
    expect(mockDbUpdateTweet).toHaveBeenCalledWith("t-1", {
      status: "cancelled",
    });
  });

  it("updates multiple fields at once", async () => {
    mockDbUpdateTweet.mockResolvedValue({ id: "t-1" });

    const req = makeJsonRequest(
      { content: "New content", scheduledAt: "2026-06-01T00:00:00Z" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));

    expect(response.status).toBe(200);
    expect(mockDbUpdateTweet).toHaveBeenCalledWith("t-1", {
      content: "New content",
      scheduledAt: new Date("2026-06-01T00:00:00Z"),
    });
  });

  it("returns 400 for invalid update data (empty content)", async () => {
    const req = makeJsonRequest(
      { content: "" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 400 for invalid update data (content > 280 chars)", async () => {
    const req = makeJsonRequest(
      { content: "a".repeat(281) },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 400 for invalid status value", async () => {
    const req = makeJsonRequest(
      { status: "invalid_status" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("handles errors from dbUpdateTweet", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockDbUpdateTweet.mockRejectedValue(new NotFoundError("Tweet", "t-1"));

    const req = makeJsonRequest(
      { content: "Updated" },
      "http://localhost/api/tweets/t-1"
    );
    const response = await detailPUT(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("DELETE /api/tweets/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveTweet.mockResolvedValue(undefined);
  });

  it("removes a tweet and returns 204", async () => {
    const req = new NextRequest("http://localhost/api/tweets/t-1");
    const response = await detailDELETE(req, makeParams("t-1"));

    expect(response.status).toBe(204);
    expect(mockRemoveTweet).toHaveBeenCalledWith("t-1");
  });

  it("handles NotFoundError from removeTweet", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockRemoveTweet.mockRejectedValue(new NotFoundError("Tweet", "t-1"));

    const req = new NextRequest("http://localhost/api/tweets/t-1");
    const response = await detailDELETE(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("handles ConflictError when tweet is being sent", async () => {
    const { ConflictError } = await import("@/lib/api/errors");
    mockRemoveTweet.mockRejectedValue(
      new ConflictError("Cannot delete tweet currently being sent")
    );

    const req = new NextRequest("http://localhost/api/tweets/t-1");
    const response = await detailDELETE(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/tweets/:id/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getTweet returns a scheduled tweet so the cancel can proceed
    mockGetTweet.mockResolvedValue({
      id: "t-1",
      content: "Hello",
      status: "scheduled",
      accountId: "acct-1",
      mediaKey: null,
      scheduledTweetRestId: null,
    });
    mockCancelTweet.mockResolvedValue(undefined);
  });

  it("cancels a tweet and returns success", async () => {
    const req = new NextRequest("http://localhost/api/tweets/t-1/cancel");
    const response = await cancelPOST(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.cancelled).toBe(true);
    expect(mockCancelTweet).toHaveBeenCalledWith("t-1");
  });

  it("handles errors from cancelTweet", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockGetTweet.mockResolvedValue({ id: "t-1", status: "scheduled" });
    mockCancelTweet.mockRejectedValue(new NotFoundError("Tweet", "t-1"));

    const req = new NextRequest("http://localhost/api/tweets/t-1/cancel");
    const response = await cancelPOST(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/tweets/:id/post-now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when tweet is posted", async () => {
    mockPublishTweet.mockResolvedValue({
      success: true,
      tweetId: "x-tweet-123",
    });

    const req = new NextRequest("http://localhost/api/tweets/t-1/post-now");
    const response = await postNowPOST(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.tweetId).toBe("x-tweet-123");
    expect(body.data.posted).toBe(true);
    expect(mockPublishTweet).toHaveBeenCalledWith("t-1", "manual");
  });

  it("returns failure result when tweet posting fails", async () => {
    mockPublishTweet.mockResolvedValue({
      success: false,
      tweetId: "t-1",
      error: "Circuit open",
    });

    const req = new NextRequest("http://localhost/api/tweets/t-1/post-now");
    const response = await postNowPOST(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.posted).toBe(false);
    expect(body.data.error).toBe("Circuit open");
  });

  it("handles errors from publishTweet", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockPublishTweet.mockRejectedValue(new NotFoundError("Tweet", "t-1"));

    const req = new NextRequest("http://localhost/api/tweets/t-1/post-now");
    const response = await postNowPOST(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("handles generic errors from publishTweet", async () => {
    mockPublishTweet.mockRejectedValue(new Error("Unexpected error"));

    const req = new NextRequest("http://localhost/api/tweets/t-1/post-now");
    const response = await postNowPOST(req, makeParams("t-1"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Internal server error");
  });
});
