// Tests for src/lib/twitter/circuit-breaker.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockAccountFindUnique = vi.fn();
const mockAccountUpdate = vi.fn();
const mockAccountFindMany = vi.fn();

vi.mock("@/lib/db/db", () => ({
  db: {
    account: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
      update: (...args: unknown[]) => mockAccountUpdate(...args),
      findMany: (...args: unknown[]) => mockAccountFindMany(...args),
    },
  },
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import {
  getCircuitState,
  recordSuccess,
  recordFailure,
  closeCircuit,
  getOpenCircuits,
} from "@/lib/twitter/circuit-breaker";
import { CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_COOLDOWN_MS } from "@/config/constants";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getCircuitState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns closed state when account not found", async () => {
    mockAccountFindUnique.mockResolvedValue(null);

    const state = await getCircuitState("nonexistent-id");

    expect(state).toEqual({
      isOpen: false,
      failureCount: 0,
      cooldownUntil: null,
    });
  });

  it("returns closed state when failureCount is below threshold", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 0,
      circuitOpenUntil: null,
    });

    const state = await getCircuitState("account-1");

    expect(state.isOpen).toBe(false);
    expect(state.failureCount).toBe(0);
    expect(state.cooldownUntil).toBeNull();
  });

  it("returns closed state when failureCount is below threshold even with circuitOpenUntil", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 1,
      circuitOpenUntil: new Date(Date.now() + 100000),
    });

    const state = await getCircuitState("account-1");

    expect(state.isOpen).toBe(false);
  });

  it("returns closed state when failureCount >= threshold but circuitOpenUntil is null", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenUntil: null,
    });

    const state = await getCircuitState("account-1");

    expect(state.isOpen).toBe(false);
  });

  it("returns closed state (auto-closed) when circuitOpenUntil is in the past", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenUntil: new Date(Date.now() - 10000), // 10 seconds ago
    });

    const state = await getCircuitState("account-1");

    expect(state.isOpen).toBe(false);
  });

  it("returns open state when failureCount >= threshold and circuitOpenUntil is in the future", async () => {
    const futureDate = new Date(Date.now() + 100000);
    mockAccountFindUnique.mockResolvedValue({
      failureCount: CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenUntil: futureDate,
    });

    const state = await getCircuitState("account-1");

    expect(state.isOpen).toBe(true);
    expect(state.failureCount).toBe(CIRCUIT_FAILURE_THRESHOLD);
    expect(state.cooldownUntil).toEqual(futureDate);
  });

  it("queries with correct select fields", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 0,
      circuitOpenUntil: null,
    });

    await getCircuitState("account-1");

    expect(mockAccountFindUnique).toHaveBeenCalledWith({
      where: { id: "account-1" },
      select: { failureCount: true, circuitOpenUntil: true },
    });
  });
});

describe("recordSuccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountUpdate.mockResolvedValue({});
  });

  it("resets failureCount to 0, circuitOpenUntil to null, and lastFailureAt to null", async () => {
    await recordSuccess("account-1");

    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        failureCount: 0,
        circuitOpenUntil: null,
        lastFailureAt: null,
      },
    });
  });
});

describe("recordFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountUpdate.mockResolvedValue({});
  });

  it("increments failureCount from 0 to 1 and does not open circuit (with recent lastFailureAt)", async () => {
    // Simulate a recent lastFailureAt so the 30-min window logic keeps the count
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 0,
      lastFailureAt: new Date(), // recent — within 30-min window
    });

    const state = await recordFailure("account-1");

    expect(state.isOpen).toBe(false);
    expect(state.failureCount).toBe(1);
    expect(state.cooldownUntil).toBeNull();
  });

  it("increments failureCount and opens circuit when threshold reached", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: CIRCUIT_FAILURE_THRESHOLD - 1,
      lastFailureAt: new Date(), // recent — within 30-min window
    });

    const state = await recordFailure("account-1");

    expect(state.isOpen).toBe(true);
    expect(state.failureCount).toBe(CIRCUIT_FAILURE_THRESHOLD);
    expect(state.cooldownUntil).not.toBeNull();
    // cooldown should be approximately CIRCUIT_COOLDOWN_MS from now
    const cooldownMs = (state.cooldownUntil ?? new Date()).getTime() - Date.now();
    expect(cooldownMs).toBeGreaterThan(CIRCUIT_COOLDOWN_MS - 1000);
    expect(cooldownMs).toBeLessThanOrEqual(CIRCUIT_COOLDOWN_MS + 1000);
  });

  it("continues incrementing beyond threshold", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: CIRCUIT_FAILURE_THRESHOLD,
      lastFailureAt: new Date(), // recent — within 30-min window
    });

    const state = await recordFailure("account-1");

    expect(state.isOpen).toBe(true);
    expect(state.failureCount).toBe(CIRCUIT_FAILURE_THRESHOLD + 1);
    expect(state.cooldownUntil).not.toBeNull();
  });

  it("handles account not found (null) by starting count at 1", async () => {
    mockAccountFindUnique.mockResolvedValue(null);

    const state = await recordFailure("account-1");

    expect(state.failureCount).toBe(1);
    expect(state.isOpen).toBe(false);
  });

  it("resets count to 1 when last failure was >30 min ago (window expired)", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 5,
      lastFailureAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    });

    const state = await recordFailure("account-1");

    // Count resets to 1 because the window expired
    expect(state.failureCount).toBe(1);
    expect(state.isOpen).toBe(false);
  });

  it("sets circuitOpenUntil when threshold is reached", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: CIRCUIT_FAILURE_THRESHOLD - 1,
      lastFailureAt: new Date(),
    });

    await recordFailure("account-1");

    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        failureCount: CIRCUIT_FAILURE_THRESHOLD,
        lastFailureAt: expect.any(Date),
        circuitOpenUntil: expect.any(Date),
      },
    });
  });

  it("does not set circuitOpenUntil when threshold is not reached", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 0,
      lastFailureAt: new Date(),
    });

    await recordFailure("account-1");

    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        failureCount: 1,
        lastFailureAt: expect.any(Date),
        circuitOpenUntil: null,
      },
    });
  });

  it("skips increment for non-infrastructure error classes (e.g., rate_limit)", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 2,
      circuitOpenUntil: null,
    });

    // Pass a skip error class — should return current state without incrementing
    const state = await recordFailure("account-1", "rate_limit" as const);

    expect(state.failureCount).toBe(2);
    // account.update should NOT be called for skip classes
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });

  it("skips increment for duplicate_posted error class", async () => {
    mockAccountFindUnique.mockResolvedValue({
      failureCount: 1,
      circuitOpenUntil: null,
    });

    const state = await recordFailure("account-1", "duplicate_posted" as const);

    expect(state.failureCount).toBe(1);
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });
});

describe("closeCircuit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountUpdate.mockResolvedValue({});
  });

  it("resets failureCount to 0, circuitOpenUntil to null, and lastFailureAt to null", async () => {
    await closeCircuit("account-1");

    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        failureCount: 0,
        circuitOpenUntil: null,
        lastFailureAt: null,
      },
    });
  });
});

describe("getOpenCircuits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns accounts with open circuits", async () => {
    const futureDate = new Date(Date.now() + 100000);
    const openAccounts = [
      { id: "acc-1", username: "user1", circuitOpenUntil: futureDate },
      { id: "acc-2", username: "user2", circuitOpenUntil: futureDate },
    ];
    mockAccountFindMany.mockResolvedValue(openAccounts);

    const result = await getOpenCircuits();

    expect(result).toEqual(openAccounts);
    expect(mockAccountFindMany).toHaveBeenCalledWith({
      where: {
        circuitOpenUntil: { gt: expect.any(Date) },
      },
      select: {
        id: true,
        username: true,
        circuitOpenUntil: true,
      },
    });
  });

  it("returns empty array when no circuits are open", async () => {
    mockAccountFindMany.mockResolvedValue([]);

    const result = await getOpenCircuits();

    expect(result).toEqual([]);
  });
});
