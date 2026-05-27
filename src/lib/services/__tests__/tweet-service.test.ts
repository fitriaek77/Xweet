// Tests for src/lib/services/tweet-service.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/queries/tweets", () => ({
  createTweet: vi.fn(),
  getTweetById: vi.fn(),
  getTweets: vi.fn(),
  updateTweet: vi.fn(),
  deleteTweet: vi.fn(),
  transitionTweetStatus: vi.fn(),
  countXScheduledForAccount: vi.fn(),
  getDueTweets: vi.fn(),
}));

vi.mock("@/lib/db/queries/locks", () => ({
  acquirePostingLock: vi.fn(),
  releasePostingLock: vi.fn(),
}));

vi.mock("@/lib/db/queries/logs", () => ({
  createLog: vi.fn(),
}));

vi.mock("@/lib/services/encryption-service", () => ({
  encryptAndStoreCookies: vi.fn(),
  decryptCookies: vi.fn(),
}));

vi.mock("@/lib/twitter/ct0-refresh", () => ({
  parseCookieString: vi.fn(),
}));

vi.mock("@/lib/twitter/post-tweet", () => ({
  createTweet: vi.fn(),
}));

vi.mock("@/lib/twitter/scheduled-tweet", () => ({
  createScheduledTweet: vi.fn(),
  deleteScheduledTweet: vi.fn(),
}));

vi.mock("@/lib/twitter/media-upload", () => ({
  uploadMedia: vi.fn(),
  getMediaCategory: vi.fn(),
}));

vi.mock("@/lib/twitter/circuit-breaker", () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getCircuitState: vi.fn(),
}));

vi.mock("@/lib/utils/retry", () => ({
  withRetry: vi.fn((fn) => fn()),
}));

vi.mock("@/lib/utils/error-classifier", () => ({
  isTransientError: vi.fn(),
  classifyError: vi.fn(),
}));

vi.mock("@/lib/storage/b2", () => ({
  uploadMedia: vi.fn(),
  downloadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  generateMediaKey: vi.fn(() => "media/test-id-abcd1234.png"),
}));

import {
  createTweet,
  getTweetById,
  getTweets,
  updateTweet,
  deleteTweet,
  transitionTweetStatus,
  countXScheduledForAccount,
} from "@/lib/db/queries/tweets";
import {
  acquirePostingLock,
  releasePostingLock,
} from "@/lib/db/queries/locks";
import { createLog } from "@/lib/db/queries/logs";
import { decryptCookies } from "@/lib/services/encryption-service";
import { parseCookieString } from "@/lib/twitter/ct0-refresh";
import { createTweet as xCreateTweet } from "@/lib/twitter/post-tweet";
import {
  createScheduledTweet,
  deleteScheduledTweet,
} from "@/lib/twitter/scheduled-tweet";
import { uploadMedia, getMediaCategory } from "@/lib/twitter/media-upload";
import { recordSuccess, recordFailure, getCircuitState } from "@/lib/twitter/circuit-breaker";
import { withRetry } from "@/lib/utils/retry";
import {
  uploadMedia as b2UploadMedia,
  downloadMedia as b2DownloadMedia,
  deleteMedia as b2DeleteMedia,
} from "@/lib/storage/b2";
import {
  scheduleNewTweet,
  publishTweet,
  cancelTweet,
  listTweets,
  getTweet,
  removeTweet,
} from "@/lib/services/tweet-service";
import { CircuitOpenError } from "@/lib/api/errors";

// Helper to build a mock tweet object
function mockTweet(overrides: Record<string, unknown> = {}) {
  return {
    id: "tweet-1",
    accountId: "acct-1",
    content: "Hello world",
    status: "scheduled",
    scheduledAt: new Date("2025-01-01T12:00:00Z"),
    retryCount: 0,
    mediaKey: null,
    mediaMimeType: null,
    mediaCategory: null,
    scheduledTweetRestId: null,
    ...overrides,
  } as never;
}

describe("tweet-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── scheduleNewTweet ───

  describe("scheduleNewTweet", () => {
    it("throws CircuitOpenError when circuit is open", async () => {
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: true,
        failureCount: 3,
        cooldownUntil: new Date(Date.now() + 1800000),
      });

      await expect(
        scheduleNewTweet({
          accountId: "acct-1",
          content: "test",
          scheduledAt: new Date(),
        })
      ).rejects.toThrow(CircuitOpenError);
    });

    it("creates tweet, logs, and attempts X scheduling", async () => {
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      const tweet = mockTweet();
      vi.mocked(createTweet).mockResolvedValue(tweet);
      vi.mocked(getTweetById).mockResolvedValue(tweet);
      // X scheduling: count below limit
      vi.mocked(countXScheduledForAccount).mockResolvedValue(0);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(createScheduledTweet).mockResolvedValue({
        restId: "x-rest-1",
      });
      vi.mocked(transitionTweetStatus).mockResolvedValue(true);

      const scheduledAt = new Date("2025-06-01T12:00:00Z");
      await scheduleNewTweet({
        accountId: "acct-1",
        content: "test tweet",
        scheduledAt,
      });

      expect(createTweet).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acct-1",
          content: "test tweet",
          scheduledAt,
        })
      );
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "create",
        })
      );
      expect(getTweetById).toHaveBeenCalledWith("tweet-1");
    });

    it("uploads media to B2 when provided", async () => {
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      const tweet = mockTweet({
        mediaKey: "media/test-id-abcd1234.png",
        mediaMimeType: "image/png",
        mediaCategory: "tweet_image",
      });
      vi.mocked(createTweet).mockResolvedValue(tweet);
      vi.mocked(getTweetById).mockResolvedValue(tweet);
      vi.mocked(getMediaCategory).mockReturnValue("tweet_image");
      // X scheduling overflows so we skip it
      vi.mocked(countXScheduledForAccount).mockResolvedValue(100);

      await scheduleNewTweet({
        accountId: "acct-1",
        content: "with media",
        scheduledAt: new Date(),
        mediaData: Buffer.from([1, 2, 3]),
        mediaMimeType: "image/png",
      });

      expect(getMediaCategory).toHaveBeenCalledWith("image/png");
      // Should upload to B2
      expect(b2UploadMedia).toHaveBeenCalledWith(
        expect.any(String), // media key
        expect.any(Buffer), // media data
        "image/png"
      );
      // Should store mediaKey instead of raw bytes
      expect(createTweet).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaKey: expect.any(String),
          mediaMimeType: "image/png",
          mediaCategory: "tweet_image",
        })
      );
      // Should NOT have mediaData in the create call
      expect(createTweet).not.toHaveBeenCalledWith(
        expect.objectContaining({
          mediaData: expect.anything(),
        })
      );
    });
  });

  // ─── publishTweet ───

  describe("publishTweet", () => {
    it("returns error when circuit is open", async () => {
      vi.mocked(getTweetById).mockResolvedValue(mockTweet());
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: true,
        failureCount: 3,
        cooldownUntil: new Date("2025-01-01T13:00:00Z"),
      });

      const result = await publishTweet("tweet-1", "cron");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Circuit open");
    });

    it("returns error when lock cannot be acquired", async () => {
      vi.mocked(getTweetById).mockResolvedValue(mockTweet());
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      vi.mocked(acquirePostingLock).mockResolvedValue(false);

      const result = await publishTweet("tweet-1", "cron");

      expect(result.success).toBe(false);
      expect(result.error).toContain("already being processed");
    });

    it("returns error when status transition fails", async () => {
      vi.mocked(getTweetById).mockResolvedValue(mockTweet());
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      vi.mocked(acquirePostingLock).mockResolvedValue(true);
      vi.mocked(transitionTweetStatus).mockResolvedValue(false);

      const result = await publishTweet("tweet-1", "cron");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Status transition failed");
      // Should release lock on failed transition
      expect(releasePostingLock).toHaveBeenCalledWith("tweet-1", "cron");
    });

    it("transitions to 'sent' on success", async () => {
      const tweet = mockTweet();
      vi.mocked(getTweetById).mockResolvedValue(tweet);
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      vi.mocked(acquirePostingLock).mockResolvedValue(true);
      // First transition: scheduled → sending
      vi.mocked(transitionTweetStatus)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(withRetry).mockImplementation((fn) => fn());
      vi.mocked(xCreateTweet).mockResolvedValue({
        tweetId: "x-tweet-123",
        text: "Hello world",
      });

      const result = await publishTweet("tweet-1", "manual");

      expect(result.success).toBe(true);
      expect(result.tweetId).toBe("x-tweet-123");

      // Verify transitions
      expect(transitionTweetStatus).toHaveBeenNthCalledWith(
        1,
        "tweet-1",
        "scheduled",
        "sending"
      );
      expect(transitionTweetStatus).toHaveBeenNthCalledWith(
        2,
        "tweet-1",
        "sending",
        "sent",
        expect.objectContaining({ tweetId: "x-tweet-123" })
      );

      expect(recordSuccess).toHaveBeenCalledWith("acct-1");
      expect(releasePostingLock).toHaveBeenCalledWith("tweet-1", "manual");
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "post_success" })
      );
    });

    it("transitions to 'failed' on error and records failure", async () => {
      const tweet = mockTweet({ retryCount: 1 });
      vi.mocked(getTweetById).mockResolvedValue(tweet);
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      vi.mocked(acquirePostingLock).mockResolvedValue(true);
      vi.mocked(transitionTweetStatus)
        .mockResolvedValueOnce(true) // scheduled → sending
        .mockResolvedValueOnce(true); // sending → failed
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(withRetry).mockImplementation(() => {
        throw new Error("X API rate limited");
      });
      vi.mocked(recordFailure).mockResolvedValue({
        isOpen: false,
        failureCount: 1,
        cooldownUntil: null,
      });

      const result = await publishTweet("tweet-1", "cron");

      expect(result.success).toBe(false);
      expect(result.error).toContain("X API rate limited");

      // Verify failure transition increments retry count
      expect(transitionTweetStatus).toHaveBeenNthCalledWith(
        2,
        "tweet-1",
        "sending",
        "failed",
        expect.objectContaining({
          failureReason: "X API rate limited",
          retryCount: 2, // 1 + 1
        })
      );

      expect(recordFailure).toHaveBeenCalledWith("acct-1", undefined);
      expect(releasePostingLock).toHaveBeenCalledWith("tweet-1", "cron");
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "post_failure" })
      );
    });

    it("downloads media from B2 and uploads to X", async () => {
      const tweet = mockTweet({
        mediaKey: "media/test-id-abcd1234.png",
        mediaMimeType: "image/png",
        mediaCategory: "tweet_image",
      });
      vi.mocked(getTweetById).mockResolvedValue(tweet);
      vi.mocked(getCircuitState).mockResolvedValue({
        isOpen: false,
        failureCount: 0,
        cooldownUntil: null,
      });
      vi.mocked(acquirePostingLock).mockResolvedValue(true);
      vi.mocked(transitionTweetStatus)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(withRetry).mockImplementation((fn) => fn());
      vi.mocked(b2DownloadMedia).mockResolvedValue(Buffer.from([1, 2, 3]));
      vi.mocked(uploadMedia).mockResolvedValue({
        mediaId: "media-123",
        mediaKey: "3_media-123",
        expiresAfterSecs: 86400,
      });
      vi.mocked(xCreateTweet).mockResolvedValue({
        tweetId: "x-tweet-456",
        text: "Hello world",
      });

      const result = await publishTweet("tweet-1", "manual");

      expect(result.success).toBe(true);
      // Should download from B2
      expect(b2DownloadMedia).toHaveBeenCalledWith("media/test-id-abcd1234.png");
      // Should upload to X
      expect(uploadMedia).toHaveBeenCalled();
      // Should store X mediaId
      expect(updateTweet).toHaveBeenCalledWith(
        "tweet-1",
        expect.objectContaining({
          mediaId: "media-123",
        })
      );
      // Should delete from B2 after success
      expect(b2DeleteMedia).toHaveBeenCalledWith("media/test-id-abcd1234.png");
      // Should clear mediaKey in DB
      expect(transitionTweetStatus).toHaveBeenNthCalledWith(
        2,
        "tweet-1",
        "sending",
        "sent",
        expect.objectContaining({
          mediaKey: null,
        })
      );
    });
  });

  // ─── cancelTweet ───

  describe("cancelTweet", () => {
    it("cancels a scheduled tweet (no X deletion needed)", async () => {
      vi.mocked(getTweetById).mockResolvedValue(
        mockTweet({ status: "scheduled" })
      );
      vi.mocked(transitionTweetStatus).mockResolvedValue(true);

      await cancelTweet("tweet-1");

      expect(deleteScheduledTweet).not.toHaveBeenCalled();
      expect(transitionTweetStatus).toHaveBeenCalledWith(
        "tweet-1",
        "scheduled",
        "cancelled",
        { mediaKey: null }
      );
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "cancel" })
      );
    });

    it("with X-scheduled tweet, tries to delete from X", async () => {
      vi.mocked(getTweetById).mockResolvedValue(
        mockTweet({
          status: "x_scheduled",
          scheduledTweetRestId: "x-rest-1",
        })
      );
      vi.mocked(transitionTweetStatus).mockResolvedValue(true);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(deleteScheduledTweet).mockResolvedValue(undefined);

      await cancelTweet("tweet-1");

      expect(deleteScheduledTweet).toHaveBeenCalledWith(
        "auth_token=abc; ct0=def",
        "def",
        "x-rest-1"
      );
      expect(transitionTweetStatus).toHaveBeenCalledWith(
        "tweet-1",
        "x_scheduled",
        "cancelled",
        { mediaKey: null }
      );
    });

    it("still cancels in DB even if X deletion fails", async () => {
      vi.mocked(getTweetById).mockResolvedValue(
        mockTweet({
          status: "x_scheduled",
          scheduledTweetRestId: "x-rest-1",
        })
      );
      vi.mocked(transitionTweetStatus).mockResolvedValue(true);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(deleteScheduledTweet).mockRejectedValue(
        new Error("X API error")
      );

      // Should NOT throw
      await cancelTweet("tweet-1");

      expect(transitionTweetStatus).toHaveBeenCalledWith(
        "tweet-1",
        "x_scheduled",
        "cancelled",
        { mediaKey: null }
      );
    });

    it("deletes B2 media when cancelling tweet with media", async () => {
      vi.mocked(getTweetById).mockResolvedValue(
        mockTweet({
          status: "scheduled",
          mediaKey: "media/test-id-abcd1234.png",
        })
      );
      vi.mocked(transitionTweetStatus).mockResolvedValue(true);

      await cancelTweet("tweet-1");

      expect(b2DeleteMedia).toHaveBeenCalledWith("media/test-id-abcd1234.png");
      expect(transitionTweetStatus).toHaveBeenCalledWith(
        "tweet-1",
        "scheduled",
        "cancelled",
        { mediaKey: null }
      );
    });
  });

  // ─── listTweets ───

  describe("listTweets", () => {
    it("delegates to getTweets with filters", async () => {
      const tweets = [mockTweet()];
      vi.mocked(getTweets).mockResolvedValue(tweets as never);

      const result = await listTweets({ accountId: "acct-1", limit: 10 });

      expect(result).toBe(tweets);
      expect(getTweets).toHaveBeenCalledWith({
        accountId: "acct-1",
        limit: 10,
      });
    });

    it("delegates to getTweets without filters", async () => {
      vi.mocked(getTweets).mockResolvedValue([]);

      await listTweets();

      expect(getTweets).toHaveBeenCalledWith(undefined);
    });
  });

  // ─── getTweet ───

  describe("getTweet", () => {
    it("delegates to getTweetById", async () => {
      const tweet = mockTweet();
      vi.mocked(getTweetById).mockResolvedValue(tweet);

      const result = await getTweet("tweet-1");

      expect(result).toBe(tweet);
      expect(getTweetById).toHaveBeenCalledWith("tweet-1");
    });
  });

  // ─── removeTweet ───

  describe("removeTweet", () => {
    it("delegates to deleteTweet", async () => {
      vi.mocked(getTweetById).mockResolvedValue(mockTweet());
      vi.mocked(deleteTweet).mockResolvedValue(mockTweet());

      await removeTweet("tweet-1");

      expect(deleteTweet).toHaveBeenCalledWith("tweet-1");
    });

    it("deletes B2 media when removing tweet with media", async () => {
      vi.mocked(getTweetById).mockResolvedValue(
        mockTweet({ mediaKey: "media/test-id-abcd1234.png" })
      );
      vi.mocked(deleteTweet).mockResolvedValue(mockTweet());

      await removeTweet("tweet-1");

      expect(b2DeleteMedia).toHaveBeenCalledWith("media/test-id-abcd1234.png");
    });
  });
});
