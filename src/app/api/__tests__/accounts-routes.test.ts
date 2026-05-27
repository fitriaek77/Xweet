// Tests for /api/accounts routes: list, create, get, update, delete, verify, refresh-ct0
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock withAuth as passthrough — bypasses auth for route testing
 
vi.mock("@/lib/api/proxy", () => ({
  withAuth: (fn: (...args: unknown[]) => unknown) => fn,
  withCronSecret: (fn: (...args: unknown[]) => unknown) => fn,
}));

// Mock account-service
const mockListAccounts = vi.fn();
const mockAddAccount = vi.fn();
const mockGetAccount = vi.fn();
const mockModifyAccount = vi.fn();
const mockRemoveAccount = vi.fn();
const mockVerifyAccount = vi.fn();
const mockRefreshAccountCt0 = vi.fn();

vi.mock("@/lib/services/account-service", () => ({
  listAccounts: (...args: unknown[]) => mockListAccounts(...args),
  addAccount: (...args: unknown[]) => mockAddAccount(...args),
  getAccount: (...args: unknown[]) => mockGetAccount(...args),
  modifyAccount: (...args: unknown[]) => mockModifyAccount(...args),
  removeAccount: (...args: unknown[]) => mockRemoveAccount(...args),
  verifyAccount: (...args: unknown[]) => mockVerifyAccount(...args),
  refreshAccountCt0: (...args: unknown[]) => mockRefreshAccountCt0(...args),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { GET as listGET, POST as listPOST } from "@/app/api/accounts/route";
import {
  GET as detailGET,
  PUT as detailPUT,
  DELETE as detailDELETE,
} from "@/app/api/accounts/[id]/route";
import { POST as verifyPOST } from "@/app/api/accounts/[id]/verify/route";
import { POST as refreshCt0POST } from "@/app/api/accounts/[id]/refresh-ct0/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJsonRequest(body: unknown, url = "http://localhost/api/accounts"): NextRequest {
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

describe("GET /api/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of accounts", async () => {
    const accounts = [
      { id: "acc-1", username: "user1" },
      { id: "acc-2", username: "user2" },
    ];
    mockListAccounts.mockResolvedValue(accounts);

    const response = await listGET(new NextRequest("http://localhost/api/accounts"), undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(accounts);
  });

  it("handles errors from listAccounts", async () => {
    mockListAccounts.mockRejectedValue(new Error("DB error"));

    const response = await listGET(new NextRequest("http://localhost/api/accounts"), undefined);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an account with valid data", async () => {
    const newAccount = { id: "acc-1", username: "testuser" };
    mockAddAccount.mockResolvedValue(newAccount);

    const req = makeJsonRequest({
      username: "testuser",
      cookies: "auth_token=abc; ct0=xyz",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(newAccount);
    expect(mockAddAccount).toHaveBeenCalledWith({
      username: "testuser",
      cookies: "auth_token=abc; ct0=xyz",
    });
  });

  it("creates an account with displayName", async () => {
    mockAddAccount.mockResolvedValue({ id: "acc-1", username: "testuser" });

    const req = makeJsonRequest({
      username: "testuser",
      cookies: "auth_token=abc; ct0=xyz",
      displayName: "Test User",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(mockAddAccount).toHaveBeenCalledWith({
      username: "testuser",
      cookies: "auth_token=abc; ct0=xyz",
      displayName: "Test User",
    });
  });

  it("returns 400 when username is missing", async () => {
    const req = makeJsonRequest({
      cookies: "auth_token=abc; ct0=xyz",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("username");
  });

  it("returns 400 when cookies is missing", async () => {
    const req = makeJsonRequest({
      username: "testuser",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("cookies");
  });

  it("returns 400 when username is too long (>15 chars)", async () => {
    const req = makeJsonRequest({
      username: "a".repeat(16),
      cookies: "auth_token=abc; ct0=xyz",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 400 when username has invalid characters", async () => {
    const req = makeJsonRequest({
      username: "invalid user!",
      cookies: "auth_token=abc; ct0=xyz",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("handles errors from addAccount", async () => {
    mockAddAccount.mockRejectedValue(new Error("DB error"));

    const req = makeJsonRequest({
      username: "testuser",
      cookies: "auth_token=abc; ct0=xyz",
    });
    const response = await listPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/accounts/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns account details", async () => {
    const account = { id: "acc-1", username: "user1" };
    mockGetAccount.mockResolvedValue(account);

    const req = new NextRequest("http://localhost/api/accounts/acc-1");
    const response = await detailGET(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(account);
    expect(mockGetAccount).toHaveBeenCalledWith("acc-1");
  });

  it("handles NotFoundError from getAccount", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockGetAccount.mockRejectedValue(new NotFoundError("Account", "acc-1"));

    const req = new NextRequest("http://localhost/api/accounts/acc-1");
    const response = await detailGET(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("PUT /api/accounts/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates an account with valid data", async () => {
    const updatedAccount = { id: "acc-1", username: "user1", displayName: "New Name" };
    mockModifyAccount.mockResolvedValue(updatedAccount);

    const req = makeJsonRequest(
      { displayName: "New Name" },
      "http://localhost/api/accounts/acc-1"
    );
    const response = await detailPUT(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(updatedAccount);
    expect(mockModifyAccount).toHaveBeenCalledWith("acc-1", { displayName: "New Name" });
  });

  it("updates isActive field", async () => {
    mockModifyAccount.mockResolvedValue({ id: "acc-1", isActive: false });

    const req = makeJsonRequest(
      { isActive: false },
      "http://localhost/api/accounts/acc-1"
    );
    const response = await detailPUT(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockModifyAccount).toHaveBeenCalledWith("acc-1", { isActive: false });
  });

  it("returns 400 for invalid update data (empty cookies)", async () => {
    const req = makeJsonRequest(
      { cookies: "" },
      "http://localhost/api/accounts/acc-1"
    );
    const response = await detailPUT(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("handles errors from modifyAccount", async () => {
    mockModifyAccount.mockRejectedValue(new Error("DB error"));

    const req = makeJsonRequest(
      { displayName: "New Name" },
      "http://localhost/api/accounts/acc-1"
    );
    const response = await detailPUT(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
  });
});

describe("DELETE /api/accounts/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveAccount.mockResolvedValue(undefined);
  });

  it("removes an account and returns 204", async () => {
    const req = new NextRequest("http://localhost/api/accounts/acc-1");
    const response = await detailDELETE(req, makeParams("acc-1"));

    expect(response.status).toBe(204);
    expect(mockRemoveAccount).toHaveBeenCalledWith("acc-1");
  });

  it("handles errors from removeAccount", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockRemoveAccount.mockRejectedValue(new NotFoundError("Account", "acc-1"));

    const req = new NextRequest("http://localhost/api/accounts/acc-1");
    const response = await detailDELETE(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/accounts/:id/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns verification result for valid account", async () => {
    mockVerifyAccount.mockResolvedValue({
      valid: true,
      ct0: "new-ct0",
      twid: "12345",
    });

    const req = new NextRequest("http://localhost/api/accounts/acc-1/verify");
    const response = await verifyPOST(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.valid).toBe(true);
    expect(body.data.ct0).toBe("new-ct0");
    expect(mockVerifyAccount).toHaveBeenCalledWith("acc-1");
  });

  it("returns verification result for invalid cookies", async () => {
    mockVerifyAccount.mockResolvedValue({
      valid: false,
      error: "ct0 refresh failed",
    });

    const req = new NextRequest("http://localhost/api/accounts/acc-1/verify");
    const response = await verifyPOST(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.valid).toBe(false);
    expect(body.data.error).toBe("ct0 refresh failed");
  });

  it("handles errors from verifyAccount", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockVerifyAccount.mockRejectedValue(new NotFoundError("Account", "acc-1"));

    const req = new NextRequest("http://localhost/api/accounts/acc-1/verify");
    const response = await verifyPOST(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/accounts/:id/refresh-ct0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success result when ct0 refresh succeeds", async () => {
    mockRefreshAccountCt0.mockResolvedValue({
      success: true,
      ct0: "refreshed-ct0",
    });

    const req = new NextRequest("http://localhost/api/accounts/acc-1/refresh-ct0");
    const response = await refreshCt0POST(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBe(true);
    expect(body.data.ct0).toBe("refreshed-ct0");
    expect(mockRefreshAccountCt0).toHaveBeenCalledWith("acc-1");
  });

  it("returns failure result when ct0 refresh fails", async () => {
    mockRefreshAccountCt0.mockResolvedValue({
      success: false,
      error: "Network timeout",
    });

    const req = new NextRequest("http://localhost/api/accounts/acc-1/refresh-ct0");
    const response = await refreshCt0POST(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBe(false);
    expect(body.data.error).toBe("Network timeout");
  });

  it("handles errors from refreshAccountCt0", async () => {
    const { NotFoundError } = await import("@/lib/api/errors");
    mockRefreshAccountCt0.mockRejectedValue(new NotFoundError("Account", "acc-1"));

    const req = new NextRequest("http://localhost/api/accounts/acc-1/refresh-ct0");
    const response = await refreshCt0POST(req, makeParams("acc-1"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});
