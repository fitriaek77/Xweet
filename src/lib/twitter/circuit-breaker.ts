// src/lib/twitter/circuit-breaker.ts
// Per-account circuit breaker for X API failures.
// After 3 failures within a 30-min window → open circuit (30 min cooldown).
// Non-infrastructure errors (auth_failure, rate_limit, stealth_ban, duplicate_posted)
// are skipped — they don't represent real infrastructure problems.
// On success → reset failure count and lastFailureAt.

import { CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_COOLDOWN_MS } from "@/config/constants";
import { db } from "@/lib/db/db";
import type { ErrorClass } from "@/lib/utils/error-classifier";

export interface CircuitState {
  isOpen: boolean;
  failureCount: number;
  cooldownUntil: Date | null;
}

const CIRCUIT_WINDOW_MS = 30 * 60 * 1000; // 30 min

// Errors that don't represent real infrastructure failures
const SKIP_ERROR_CLASSES: ErrorClass[] = ['auth_failure', 'rate_limit', 'stealth_ban', 'duplicate_posted'];

/** Get current circuit breaker state for an account. */
export async function getCircuitState(accountId: string): Promise<CircuitState> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { failureCount: true, circuitOpenUntil: true },
  });

  if (!account) {
    return { isOpen: false, failureCount: 0, cooldownUntil: null };
  }

  const isOpen = isCircuitOpen(account.failureCount, account.circuitOpenUntil);

  return {
    isOpen,
    failureCount: account.failureCount,
    cooldownUntil: account.circuitOpenUntil,
  };
}

function isCircuitOpen(failureCount: number, circuitOpenUntil: Date | null): boolean {
  if (failureCount < CIRCUIT_FAILURE_THRESHOLD) return false;
  if (!circuitOpenUntil) return false;
  if (new Date() > circuitOpenUntil) return false;
  return true;
}

/** Record a successful API call — reset failure count. */
export async function recordSuccess(accountId: string): Promise<void> {
  await db.account.update({
    where: { id: accountId },
    data: {
      failureCount: 0,
      circuitOpenUntil: null,
      lastFailureAt: null,
    },
  });
}

/** Record a failed API call — with failure window and error class filtering. */
export async function recordFailure(
  accountId: string,
  errorClass?: ErrorClass
): Promise<CircuitState> {
  // Skip non-real failures
  if (errorClass && SKIP_ERROR_CLASSES.includes(errorClass)) {
    return getCircuitState(accountId);
  }

  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { failureCount: true, lastFailureAt: true },
  });

  // Reset count if last failure was >30 min ago (window expired)
  const withinWindow = account?.lastFailureAt &&
    (Date.now() - account.lastFailureAt.getTime()) < CIRCUIT_WINDOW_MS;

  const newCount = account && withinWindow ? account.failureCount + 1 : 1;
  const shouldOpen = newCount >= CIRCUIT_FAILURE_THRESHOLD;

  const circuitOpenUntil = shouldOpen
    ? new Date(Date.now() + CIRCUIT_COOLDOWN_MS)
    : null;

  await db.account.update({
    where: { id: accountId },
    data: {
      failureCount: newCount,
      lastFailureAt: new Date(),
      circuitOpenUntil,
    },
  });

  return {
    isOpen: shouldOpen,
    failureCount: newCount,
    cooldownUntil: circuitOpenUntil,
  };
}

/** Manually close the circuit (admin action from UI). */
export async function closeCircuit(accountId: string): Promise<void> {
  await db.account.update({
    where: { id: accountId },
    data: {
      failureCount: 0,
      circuitOpenUntil: null,
      lastFailureAt: null,
    },
  });
}

/** Get all accounts with open circuits (for admin display). */
export async function getOpenCircuits(): Promise<
  Array<{ id: string; username: string; circuitOpenUntil: Date | null }>
> {
  return db.account.findMany({
    where: {
      circuitOpenUntil: { gt: new Date() },
    },
    select: {
      id: true,
      username: true,
      circuitOpenUntil: true,
    },
  });
}
