// Tests for src/lib/services/schedule-service.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/queries/tweets", () => ({
  getDueTweets: vi.fn(),
  transitionTweetStatus: vi.fn(),
  getTweets: vi.fn(),
  getTweetById: vi.fn(),
}));

vi.mock("@/lib/db/queries/locks", () => ({
  recoverStaleLocks: vi.fn(),
  acquirePostingLock: vi.fn(),
  releasePostingLock: vi.fn(),
}));

vi.mock("@/lib/db/queries/logs", () => ({
  createLog: vi.fn(),
}));

vi.mock("@/lib/services/tweet-service", () => ({
  publishTweet: vi.fn(),
}));

vi.mock("@/lib/services/account-service", () => ({
  refreshAccountCt0: vi.fn(),
}));

vi.mock("@/lib/services/encryption-service", () => ({
  decryptCookies: vi.fn(),
  encryptAndStoreCookies: vi.fn(),
}));

vi.mock("@/lib/twitter/ct0-refresh", () => ({
  parseCookieString: vi.fn(),
}));

vi.mock("@/lib/twitter/scheduled-tweet", () => ({
  fetchScheduledTweets: vi.fn(),
  createScheduledTweet: vi.fn(),
  deleteScheduledTweet: vi.fn(),
}));

vi.mock("@/lib/db/db", () => ({
  db: {
    account: {
      findMany: vi.fn(),
    },
    tweet: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/storage/b2", () => ({
  uploadMedia: vi.fn(),
  downloadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  generateMediaKey: vi.fn(() => "media/test-id-abcd1234.png"),
}));

vi.mock("@/lib/twitter/query-id", () => ({
  getQueryIds: vi.fn().mockResolvedValue({
    CreateTweet: "test",
    CreateScheduledTweet: "test",
    FetchScheduledTweets: "test",
    EditScheduledTweet: "test",
    DeleteScheduledTweet: "test",
  }),
}));

import { getDueTweets, transitionTweetStatus } from "@/lib/db/queries/tweets";
import { recoverStaleLocks } from "@/lib/db/queries/locks";
import { createLog } from "@/lib/db/queries/logs";
import { publishTweet } from "@/lib/services/tweet-service";
import { refreshAccountCt0 } from "@/lib/services/account-service";
import { decryptCookies } from "@/lib/services/encryption-service";
import { parseCookieString } from "@/lib/twitter/ct0-refresh";
import { fetchScheduledTweets } from "@/lib/twitter/scheduled-tweet";
import { db } from "@/lib/db/db";
import {
  executeCronTick,
  executeCronMaintenance,
} from "@/lib/services/schedule-service";

describe("schedule-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── executeCronTick ───

  describe("executeCronTick", () => {
    it("recovers stale locks and logs when count > 0", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(2);
      vi.mocked(getDueTweets).mockResolvedValue([]);
      // Mock retryable tweets query via db.tweet.findMany
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);

      const result = await executeCronTick();

      expect(recoverStaleLocks).toHaveBeenCalledOnce();
      expect(createLog).toHaveBeenCalledWith({
        action: "stale_recovery",
        detail: "Recovered 2 stale locks",
      });
      expect(result.staleRecovered).toBe(2);
    });

    it("does not log stale recovery when count is 0", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      vi.mocked(getDueTweets).mockResolvedValue([]);
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);

      const result = await executeCronTick();

      expect(result.staleRecovered).toBe(0);
      // The first call to createLog should NOT be stale_recovery
      const logCalls = vi.mocked(createLog).mock.calls;
      const staleCalls = logCalls.filter(
        (c) => (c[0] as { action?: string }).action === "stale_recovery"
      );
      expect(staleCalls).toHaveLength(0);
    });

    it("dispatches due tweets and increments count on success", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      const dueTweets = [
        { id: "tweet-1", accountId: "acct-1" },
        { id: "tweet-2", accountId: "acct-2" },
      ];
      vi.mocked(getDueTweets).mockResolvedValue(dueTweets as never);
      vi.mocked(publishTweet).mockResolvedValue({
        success: true,
        tweetId: "x-1",
      });
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);

      const result = await executeCronTick();

      expect(publishTweet).toHaveBeenCalledTimes(2);
      expect(publishTweet).toHaveBeenCalledWith("tweet-1", "cron");
      expect(publishTweet).toHaveBeenCalledWith("tweet-2", "cron");
      expect(result.dispatched).toBe(2);
    });

    it("collects errors when publishTweet returns failure", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      vi.mocked(getDueTweets).mockResolvedValue([
        { id: "tweet-1", accountId: "acct-1" },
      ] as never);
      vi.mocked(publishTweet).mockResolvedValue({
        success: false,
        tweetId: "tweet-1",
        error: "Circuit open",
      });
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);
      vi.mocked(db.account.findMany).mockResolvedValue([]);

      const result = await executeCronTick();

      expect(result.dispatched).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("tweet-1");
      expect(result.errors[0]).toContain("Circuit open");
    });

    it("collects errors when publishTweet throws", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      vi.mocked(getDueTweets).mockResolvedValue([
        { id: "tweet-1", accountId: "acct-1" },
      ] as never);
      vi.mocked(publishTweet).mockRejectedValue(new Error("Unexpected"));
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);
      vi.mocked(db.account.findMany).mockResolvedValue([]);

      const result = await executeCronTick();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Unexpected");
    });

    it("retries failed tweets with retryCount < max", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      vi.mocked(getDueTweets).mockResolvedValue([]);
      // First call to db.tweet.findMany is for retryable tweets
      vi.mocked(db.tweet.findMany).mockResolvedValue([
        { id: "tweet-fail-1", accountId: "acct-1", retryCount: 1 },
      ] as never);
      vi.mocked(transitionTweetStatus)
        .mockResolvedValueOnce(true); // failed → scheduled
      vi.mocked(publishTweet).mockResolvedValue({
        success: true,
        tweetId: "x-retry-1",
      });

      const result = await executeCronTick();

      expect(transitionTweetStatus).toHaveBeenCalledWith(
        "tweet-fail-1",
        "failed",
        "scheduled"
      );
      expect(publishTweet).toHaveBeenCalledWith("tweet-fail-1", "cron");
      expect(result.retried).toBe(1);
    });

    it("skips retry if transition fails", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      vi.mocked(getDueTweets).mockResolvedValue([]);
      vi.mocked(db.tweet.findMany).mockResolvedValue([
        { id: "tweet-fail-1", accountId: "acct-1", retryCount: 1 },
      ] as never);
      vi.mocked(transitionTweetStatus).mockResolvedValueOnce(false);

      const result = await executeCronTick();

      expect(publishTweet).not.toHaveBeenCalled();
      expect(result.retried).toBe(0);
    });

    it("returns all zeros when there is nothing to do", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);
      vi.mocked(getDueTweets).mockResolvedValue([]);
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);
      vi.mocked(db.account.findMany).mockResolvedValue([]);

      const result = await executeCronTick();

      expect(result).toEqual(
        expect.objectContaining({
          dispatched: 0,
          staleRecovered: 0,
          stalePostingsRecovered: 0,
          retried: 0,
          ct0Refreshed: 0,
          synced: 0,
          errors: [],
          budgetExceeded: false,
        })
      );
    });
  });

  // ─── executeCronMaintenance ───

  describe("executeCronMaintenance", () => {
    it("refreshes ct0 for stale accounts and reports counts", async () => {
      const staleAccounts = [
        { id: "acct-1", username: "user1" },
        { id: "acct-2", username: "user2" },
      ];
      // First call: find stale accounts
      // Second call: find X-scheduled tweets for sync
      vi.mocked(db.account.findMany).mockResolvedValue(staleAccounts as never);
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);
      vi.mocked(refreshAccountCt0).mockResolvedValue({
        success: true,
        ct0: "new-ct0",
      });

      const result = await executeCronMaintenance();

      expect(refreshAccountCt0).toHaveBeenCalledWith("acct-1");
      expect(refreshAccountCt0).toHaveBeenCalledWith("acct-2");
      expect(result.ct0Refreshed).toBe(2);
      expect(result.synced).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it("reports errors for accounts that fail ct0 refresh", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([
        { id: "acct-1", username: "user1" },
      ] as never);
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);
      vi.mocked(refreshAccountCt0).mockResolvedValue({
        success: false,
        error: "ct0 refresh failed",
      });

      const result = await executeCronMaintenance();

      expect(result.ct0Refreshed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("ct0 refresh failed");
    });

    it("reports errors when refreshAccountCt0 throws", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([
        { id: "acct-1", username: "user1" },
      ] as never);
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);
      vi.mocked(refreshAccountCt0).mockRejectedValue(
        new Error("Network timeout")
      );

      const result = await executeCronMaintenance();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Network timeout");
    });

    it("syncs X-scheduled tweets that have been posted on X", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([]);
      const xScheduledTweets = [
        {
          id: "tweet-1",
          accountId: "acct-1",
          scheduledTweetRestId: "rest-1",
          account: { username: "user1" },
        },
      ];
      vi.mocked(db.tweet.findMany).mockResolvedValue(xScheduledTweets as never);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      // The tweet is NOT in X's list anymore (was posted)
      vi.mocked(fetchScheduledTweets).mockResolvedValue({
        tweets: [],
        count: 0,
        isAtLimit: false,
      });
      vi.mocked(transitionTweetStatus).mockResolvedValue(true);

      const result = await executeCronMaintenance();

      expect(result.synced).toBe(1);
      expect(transitionTweetStatus).toHaveBeenCalledWith(
        "tweet-1",
        "x_scheduled",
        "sent",
        expect.objectContaining({ mediaKey: null })
      );
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "sync",
          detail: expect.stringContaining("sync detected"),
        })
      );
    });

    it("does not sync X-scheduled tweets still in X's list", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([]);
      const xScheduledTweets = [
        {
          id: "tweet-1",
          accountId: "acct-1",
          scheduledTweetRestId: "rest-1",
          account: { username: "user1" },
        },
      ];
      vi.mocked(db.tweet.findMany).mockResolvedValue(xScheduledTweets as never);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      // The tweet IS still in X's list (not posted yet)
      vi.mocked(fetchScheduledTweets).mockResolvedValue({
        tweets: [{
          rest_id: "rest-1",
          core: { user_results: { result: { legacy: { id: "1", name: "User", screen_name: "user", profile_image_url_https: "" } } } },
          scheduled_tweet: { execute_at: 1700000000, status: "scheduled", tweet: { rest_id: "1", legacy: { full_text: "Test" } } },
        }],
        count: 1,
        isAtLimit: false,
      });

      const result = await executeCronMaintenance();

      expect(result.synced).toBe(0);
      expect(transitionTweetStatus).not.toHaveBeenCalled();
    });

    it("skips sync for tweets without scheduledTweetRestId", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([]);
      const xScheduledTweets = [
        {
          id: "tweet-1",
          accountId: "acct-1",
          scheduledTweetRestId: null,
          account: { username: "user1" },
        },
      ];
      vi.mocked(db.tweet.findMany).mockResolvedValue(xScheduledTweets as never);
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });

      const result = await executeCronMaintenance();

      expect(result.synced).toBe(0);
      expect(fetchScheduledTweets).not.toHaveBeenCalled();
    });

    it("returns zeros and empty errors when there is nothing to do", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([]);
      vi.mocked(db.tweet.findMany).mockResolvedValue([]);

      const result = await executeCronMaintenance();

      expect(result).toEqual({
        ct0Refreshed: 0,
        synced: 0,
        errors: [],
      });
    });

    it("handles sync errors gracefully", async () => {
      vi.mocked(db.account.findMany).mockResolvedValue([]);
      const xScheduledTweets = [
        {
          id: "tweet-1",
          accountId: "acct-1",
          scheduledTweetRestId: "rest-1",
          account: { username: "user1" },
        },
      ];
      vi.mocked(db.tweet.findMany).mockResolvedValue(xScheduledTweets as never);
      vi.mocked(decryptCookies).mockRejectedValue(new Error("Decrypt failed"));

      const result = await executeCronMaintenance();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Decrypt failed");
    });
  });
});
