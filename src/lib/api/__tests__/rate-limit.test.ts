// Tests for src/lib/api/rate-limit.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from "@/lib/api/rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset rate limit state for each test by resetting known IPs
    resetRateLimit("1.2.3.4");
    resetRateLimit("5.6.7.8");
    resetRateLimit("9.9.9.9");
    resetRateLimit("10.0.0.1");
  });

  // ─── checkRateLimit ───

  describe("checkRateLimit", () => {
    it("allows requests for new IPs", () => {
      const result = checkRateLimit("192.168.1.1");

      expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
    });

    it("allows requests when under the limit", () => {
      recordFailedAttempt("1.2.3.4");
      recordFailedAttempt("1.2.3.4");
      recordFailedAttempt("1.2.3.4");
      recordFailedAttempt("1.2.3.4");

      const result = checkRateLimit("1.2.3.4");

      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    });

    it("blocks requests when count reaches MAX_ATTEMPTS (5)", () => {
      // Record 5 failed attempts
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt("5.6.7.8");
      }

      const result = checkRateLimit("5.6.7.8");

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(15 * 60 * 1000); // 15 minutes
    });

    it("continues blocking during lockout period", () => {
      // Record 5 failures to trigger lockout
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt("9.9.9.9");
      }

      // First check triggers lockout
      const result1 = checkRateLimit("9.9.9.9");
      expect(result1.allowed).toBe(false);

      // Second check still blocked
      const result2 = checkRateLimit("9.9.9.9");
      expect(result2.allowed).toBe(false);
      expect(result2.retryAfterMs).toBeGreaterThan(0);
    });

    it("allows requests after lockout window expires", () => {
      // Record 5 failures to trigger lockout
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt("10.0.0.1");
      }

      // Trigger lockout
      const blocked = checkRateLimit("10.0.0.1");
      expect(blocked.allowed).toBe(false);

      // Advance time past the lockout window
      vi.useFakeTimers();
      vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes > 15 min lockout

      // Now the window expired check should reset
      const result = checkRateLimit("10.0.0.1");
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);

      vi.useRealTimers();
    });
  });

  // ─── recordFailedAttempt ───

  describe("recordFailedAttempt", () => {
    it("creates new entry for unknown IP", () => {
      recordFailedAttempt("172.16.0.1");

      // Should now be in the rate limit store with count=1
      // Check by verifying it's still allowed (1 < 5)
      const result = checkRateLimit("172.16.0.1");
      expect(result.allowed).toBe(true);
      resetRateLimit("172.16.0.1");
    });

    it("increments count for existing IP", () => {
      recordFailedAttempt("172.16.0.2");
      recordFailedAttempt("172.16.0.2");
      recordFailedAttempt("172.16.0.2");

      // 3 attempts < 5, still allowed
      const result = checkRateLimit("172.16.0.2");
      expect(result.allowed).toBe(true);

      // Add 2 more to reach 5
      recordFailedAttempt("172.16.0.2");
      recordFailedAttempt("172.16.0.2");

      // Now blocked
      const blocked = checkRateLimit("172.16.0.2");
      expect(blocked.allowed).toBe(false);

      resetRateLimit("172.16.0.2");
    });

    it("resets count when window expires before new attempt", () => {
      recordFailedAttempt("172.16.0.3");
      recordFailedAttempt("172.16.0.3");

      // Advance past window
      vi.useFakeTimers();
      vi.advanceTimersByTime(16 * 60 * 1000);

      // New attempt should reset the count (start fresh)
      recordFailedAttempt("172.16.0.3");

      // Only 1 attempt now, should be allowed
      const result = checkRateLimit("172.16.0.3");
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
      resetRateLimit("172.16.0.3");
    });
  });

  // ─── resetRateLimit ───

  describe("resetRateLimit", () => {
    it("resets rate limit for an IP", () => {
      // Block an IP
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt("172.16.0.4");
      }
      const blocked = checkRateLimit("172.16.0.4");
      expect(blocked.allowed).toBe(false);

      // Reset
      resetRateLimit("172.16.0.4");

      // Should be allowed again
      const result = checkRateLimit("172.16.0.4");
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);

      resetRateLimit("172.16.0.4");
    });

    it("does nothing for unknown IP", () => {
      // Should not throw
      resetRateLimit("255.255.255.255");
    });
  });

  // ─── Integration: lockout + window expired ───

  describe("lockout with window expired", () => {
    it("resets locked-out IP after full window + lockout expires", () => {
      // Record 5 failures
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt("172.16.0.5");
      }

      // Check → triggers lockout
      const blocked = checkRateLimit("172.16.0.5");
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);

      // Wait for both the lockout and the window to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

      // Should be allowed now (window expired)
      const result = checkRateLimit("172.16.0.5");
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
      resetRateLimit("172.16.0.5");
    });
  });
});
