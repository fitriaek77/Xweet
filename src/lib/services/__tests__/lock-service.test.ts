// Tests for src/lib/services/lock-service.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/queries/locks", () => ({
  acquirePostingLock: vi.fn(),
  releasePostingLock: vi.fn(),
  findStaleLocks: vi.fn(),
  recoverStaleLocks: vi.fn(),
}));

vi.mock("@/lib/db/queries/logs", () => ({
  createLog: vi.fn(),
}));

import {
  acquirePostingLock,
  releasePostingLock,
  findStaleLocks,
  recoverStaleLocks,
} from "@/lib/db/queries/locks";
import { createLog } from "@/lib/db/queries/logs";
import {
  acquireLock,
  releaseLock,
  getStaleLocks,
  recoverLocks,
} from "@/lib/services/lock-service";

describe("lock-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── acquireLock ───

  describe("acquireLock", () => {
    it("logs on success", async () => {
      vi.mocked(acquirePostingLock).mockResolvedValue(true);

      const result = await acquireLock("tweet-1", "cron");

      expect(result).toBe(true);
      expect(acquirePostingLock).toHaveBeenCalledWith("tweet-1", "cron");
      expect(createLog).toHaveBeenCalledWith({
        tweetId: "tweet-1",
        action: "lock_acquire",
        detail: "Lock acquired by cron",
      });
    });

    it("does not log on failure", async () => {
      vi.mocked(acquirePostingLock).mockResolvedValue(false);

      const result = await acquireLock("tweet-1", "manual");

      expect(result).toBe(false);
      expect(acquirePostingLock).toHaveBeenCalledWith("tweet-1", "manual");
      expect(createLog).not.toHaveBeenCalled();
    });
  });

  // ─── releaseLock ───

  describe("releaseLock", () => {
    it("always logs when releasing lock", async () => {
      vi.mocked(releasePostingLock).mockResolvedValue(undefined);

      await releaseLock("tweet-1", "cron");

      expect(releasePostingLock).toHaveBeenCalledWith("tweet-1", "cron");
      expect(createLog).toHaveBeenCalledWith({
        tweetId: "tweet-1",
        action: "lock_release",
        detail: "Lock released by cron",
      });
    });

    it("logs even if releasePostingLock throws", async () => {
      vi.mocked(releasePostingLock).mockRejectedValue(new Error("DB error"));

      await expect(releaseLock("tweet-1", "manual")).rejects.toThrow("DB error");

      // createLog is called after releasePostingLock, so it won't be called if the above throws
      expect(createLog).not.toHaveBeenCalled();
    });
  });

  // ─── getStaleLocks ───

  describe("getStaleLocks", () => {
    it("delegates to findStaleLocks", async () => {
      const staleLocks = [
        { id: "tweet-1", status: "sending", lockedAt: new Date() },
      ];
      vi.mocked(findStaleLocks).mockResolvedValue(staleLocks as never);

      const result = await getStaleLocks();

      expect(result).toBe(staleLocks);
      expect(findStaleLocks).toHaveBeenCalledOnce();
    });

    it("returns empty array when no stale locks", async () => {
      vi.mocked(findStaleLocks).mockResolvedValue([]);

      const result = await getStaleLocks();

      expect(result).toEqual([]);
    });
  });

  // ─── recoverLocks ───

  describe("recoverLocks", () => {
    it("logs only when count > 0", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(3);

      const result = await recoverLocks();

      expect(result).toBe(3);
      expect(createLog).toHaveBeenCalledWith({
        action: "stale_recovery",
        detail: "Recovered 3 stale locks",
      });
    });

    it("does not log when count is 0", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(0);

      const result = await recoverLocks();

      expect(result).toBe(0);
      expect(createLog).not.toHaveBeenCalled();
    });

    it("does not log when count is 1", async () => {
      vi.mocked(recoverStaleLocks).mockResolvedValue(1);

      const result = await recoverLocks();

      expect(result).toBe(1);
      expect(createLog).toHaveBeenCalledWith({
        action: "stale_recovery",
        detail: "Recovered 1 stale locks",
      });
    });
  });
});
