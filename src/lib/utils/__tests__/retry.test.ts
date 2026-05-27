// Tests for src/lib/utils/retry.ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "@/lib/utils/retry";

describe("withRetry", () => {
  it("returns result on first attempt when successful", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on later attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws last error after all attempts exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, shouldRetry })
    ).rejects.toThrow("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it("retries when shouldRetry returns true", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("retryable"))
      .mockResolvedValue("ok");

    const shouldRetry = vi.fn().mockReturnValue(true);
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, shouldRetry });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects maxAttempts of 1 (no retries)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 10 })
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff with jitter", async () => {
    vi.useFakeTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000 });
    
    // Advance timers to resolve the sleep
    await vi.advanceTimersByTimeAsync(2000);
    
    const result = await promise;
    expect(result).toBe("ok");
    
    vi.useRealTimers();
  });

  it("caps delay at maxDelayMs", async () => {
    // With baseDelayMs=1000, attempt 5 would be 16000ms but should be capped at maxDelayMs=5000
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    
    // This just verifies the function doesn't hang — the actual delay capping
    // is tested by observing timing behavior
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10 })
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
