// Tests for /api/cron routes: tick and maintenance
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockExecuteCronTick = vi.fn();

vi.mock("@/lib/services/schedule-service", () => ({
  executeCronTick: (...args: unknown[]) => mockExecuteCronTick(...args),
}));

// Mock the proxy module — withCronSecret is used as a wrapper
// We'll let it run for real integration-style testing of the header check,
// but we need to mock its internal dependencies.
vi.mock("@/lib/db/db", () => ({
  db: {},
}));

vi.mock("@/lib/auth/session", () => ({
  hashToken: vi.fn().mockResolvedValue("fake-hash"),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { POST as tickPOST } from "@/app/api/cron/tick/route";
import { POST as maintenancePOST } from "@/app/api/cron/maintenance/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCronRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/cron/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeCronRequestWithSecret(secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) {
    headers["x-cron-secret"] = secret;
  }
  return makeCronRequest(headers);
}

// Default mock return value for executeCronTick
function defaultTickResult() {
  return {
    dispatched: 0,
    staleRecovered: 0,
    stalePostingsRecovered: 0,
    retried: 0,
    ct0Refreshed: 0,
    synced: 0,
    errors: [],
    budgetExceeded: false,
  };
}

// ─── Tests: Cron Tick ────────────────────────────────────────────────────────

describe("POST /api/cron/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteCronTick.mockResolvedValue(defaultTickResult());
  });

  describe("cron secret verification", () => {
    it("returns 403 when x-cron-secret header is missing", async () => {
      const req = makeCronRequest();
      const response = await tickPOST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Invalid cron secret");
    });

    it("returns 403 when x-cron-secret header is wrong", async () => {
      const req = makeCronRequestWithSecret("wrong-secret");
      const response = await tickPOST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Invalid cron secret");
    });

    it("passes with correct CRON_SECRET from env", async () => {
      // CRON_SECRET is set to "test-cron-secret" in vitest.setup.ts
      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await tickPOST(req);

      expect(response.status).toBe(200);
      expect(mockExecuteCronTick).toHaveBeenCalledTimes(1);
    });
  });

  describe("successful execution", () => {
    it("returns 200 with tick results", async () => {
      mockExecuteCronTick.mockResolvedValue({
        ...defaultTickResult(),
        dispatched: 3,
        staleRecovered: 1,
        retried: 0,
      });

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await tickPOST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.dispatched).toBe(3);
      expect(body.data.staleRecovered).toBe(1);
      expect(body.data.retried).toBe(0);
      expect(body.data.errors).toEqual([]);
    });

    it("returns errors from tick execution in the response data", async () => {
      mockExecuteCronTick.mockResolvedValue({
        ...defaultTickResult(),
        dispatched: 1,
        staleRecovered: 0,
        retried: 0,
        errors: ["Tweet abc: failed to post"],
      });

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await tickPOST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.errors).toEqual(["Tweet abc: failed to post"]);
    });
  });

  describe("error handling", () => {
    it("returns 500 when executeCronTick throws a generic Error", async () => {
      mockExecuteCronTick.mockRejectedValue(new Error("DB connection lost"));

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await tickPOST(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Internal server error");
    });

    it("returns appropriate status for AppError from service", async () => {
      // Import AppError to construct a proper error
      const { AppError } = await import("@/lib/api/errors");
      mockExecuteCronTick.mockRejectedValue(new AppError("Service unavailable", 503));

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await tickPOST(req);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Service unavailable");
    });
  });
});

// ─── Tests: Cron Maintenance ─────────────────────────────────────────────────
// NOTE: The maintenance route now calls executeCronTick() (merged from 2 crons into 1).
// The response shape is the same as the tick route.

describe("POST /api/cron/maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteCronTick.mockResolvedValue(defaultTickResult());
  });

  describe("cron secret verification", () => {
    it("returns 403 when x-cron-secret header is missing", async () => {
      const req = makeCronRequest();
      const response = await maintenancePOST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Invalid cron secret");
    });

    it("returns 403 when x-cron-secret header is wrong", async () => {
      const req = makeCronRequestWithSecret("not-the-right-secret");
      const response = await maintenancePOST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Invalid cron secret");
    });

    it("passes with correct CRON_SECRET from env", async () => {
      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await maintenancePOST(req);

      expect(response.status).toBe(200);
      expect(mockExecuteCronTick).toHaveBeenCalledTimes(1);
    });
  });

  describe("successful execution", () => {
    it("returns 200 with results from executeCronTick", async () => {
      mockExecuteCronTick.mockResolvedValue({
        ...defaultTickResult(),
        ct0Refreshed: 2,
        synced: 5,
      });

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await maintenancePOST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.ct0Refreshed).toBe(2);
      expect(body.data.synced).toBe(5);
      expect(body.data.errors).toEqual([]);
    });

    it("returns errors from execution in the response data", async () => {
      mockExecuteCronTick.mockResolvedValue({
        ...defaultTickResult(),
        ct0Refreshed: 0,
        synced: 0,
        errors: ["@user1: refresh failed", "Sync xyz: timeout"],
      });

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await maintenancePOST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.errors).toHaveLength(2);
      expect(body.data.errors[0]).toContain("refresh failed");
    });
  });

  describe("error handling", () => {
    it("returns 500 when executeCronTick throws", async () => {
      mockExecuteCronTick.mockRejectedValue(new Error("Unexpected failure"));

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await maintenancePOST(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Internal server error");
    });

    it("returns appropriate status for AppError from service", async () => {
      const { AppError } = await import("@/lib/api/errors");
      mockExecuteCronTick.mockRejectedValue(
        new AppError("Maintenance failed", 503)
      );

      const req = makeCronRequestWithSecret("test-cron-secret");
      const response = await maintenancePOST(req);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe("Maintenance failed");
    });
  });
});
