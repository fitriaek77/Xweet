// Tests for /api/auth routes: login, logout, change-password
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock db
const mockAdminCount = vi.fn();
const mockAdminFindFirst = vi.fn();
const mockAdminCreate = vi.fn();
const mockAdminUpdate = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionDelete = vi.fn();
const mockSessionFindUnique = vi.fn();

vi.mock("@/lib/db/db", () => ({
  db: {
    admin: {
      count: (...args: unknown[]) => mockAdminCount(...args),
      findFirst: (...args: unknown[]) => mockAdminFindFirst(...args),
      create: (...args: unknown[]) => mockAdminCreate(...args),
      update: (...args: unknown[]) => mockAdminUpdate(...args),
    },
    session: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
      delete: (...args: unknown[]) => mockSessionDelete(...args),
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
    },
  },
}));

// Mock auth/session functions
const mockVerifyPassword = vi.fn();
const mockHashPassword = vi.fn();
const mockGenerateSessionToken = vi.fn();
const mockHashToken = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
  generateSessionToken: (...args: unknown[]) => mockGenerateSessionToken(...args),
  hashToken: (...args: unknown[]) => mockHashToken(...args),
}));

// Mock auth/dal
const mockAdminExists = vi.fn();
const mockCleanExpiredSessions = vi.fn();
const mockVerifySession = vi.fn();

vi.mock("@/lib/auth/dal", () => ({
  adminExists: (...args: unknown[]) => mockAdminExists(...args),
  cleanExpiredSessions: (...args: unknown[]) => mockCleanExpiredSessions(...args),
  verifySession: (...args: unknown[]) => mockVerifySession(...args),
}));

// Mock rate limiter
const mockCheckRateLimit = vi.fn();
const mockRecordFailedAttempt = vi.fn();
const mockResetRateLimit = vi.fn();

vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  recordFailedAttempt: (...args: unknown[]) => mockRecordFailedAttempt(...args),
  resetRateLimit: (...args: unknown[]) => mockResetRateLimit(...args),
}));

// Mock next/headers — cookies
const mockCookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (...args: unknown[]) => mockCookieGet(...args),
    })
  ),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as changePasswordPOST } from "@/app/api/auth/change-password/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/auth/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeUnauthedRequest(body: unknown): NextRequest {
  // No session cookie — will fail withAuth check
  return makeRequest(body);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminExists.mockResolvedValue(true);
    mockAdminFindFirst.mockResolvedValue({
      id: "admin-1",
      passwordHash: "$2a$12$hashedpassword",
    });
    mockVerifyPassword.mockResolvedValue(true);
    mockGenerateSessionToken.mockReturnValue("abc123token");
    mockHashToken.mockResolvedValue("sha256hash");
    mockSessionCreate.mockResolvedValue({});
    mockHashPassword.mockResolvedValue("$2a$12$newhash");
    mockAdminCreate.mockResolvedValue({ id: "admin-1", passwordHash: "$2a$12$newhash" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    mockCleanExpiredSessions.mockResolvedValue(0);
  });

  it("returns 200 and authenticated:true on valid login", async () => {
    const req = makeRequest({ password: "validpassword" });
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.authenticated).toBe(true);
  });

  it("sets a session cookie on successful login", async () => {
    const req = makeRequest({ password: "validpassword" });
    const response = await loginPOST(req);

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("session_token=abc123token");
    expect(setCookieHeader).toContain("HttpOnly");
  });

  it("returns 400 when password is missing", async () => {
    const req = makeRequest({});
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid input");
  });

  it("returns 400 when password is empty string", async () => {
    const req = makeRequest({ password: "" });
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 401 when password is incorrect", async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const req = makeRequest({ password: "wrongpassword" });
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid password");
  });

  it("records failed attempt on wrong password", async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const req = makeRequest({ password: "wrongpassword" });
    await loginPOST(req);

    expect(mockRecordFailedAttempt).toHaveBeenCalled();
  });

  it("resets rate limit on successful login", async () => {
    const req = makeRequest({ password: "validpassword" });
    await loginPOST(req);

    expect(mockResetRateLimit).toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 900000 });

    const req = makeRequest({ password: "validpassword" });
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Too many login attempts");
    expect(response.headers.get("Retry-After")).toBe("900");
  });

  it("returns 401 when no admin account exists and creation is skipped", async () => {
    mockAdminExists.mockResolvedValue(true);
    mockAdminFindFirst.mockResolvedValue(null);

    const req = makeRequest({ password: "somepassword" });
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("No admin account found");
  });

  it("creates admin on first-time setup (no admin exists)", async () => {
    mockAdminExists.mockResolvedValue(false);
    // After creation, findFirst returns the new admin
    mockAdminFindFirst.mockResolvedValue({
      id: "admin-1",
      passwordHash: "$2a$12$newhash",
    });

    const req = makeRequest({ password: "firsttimepassword" });
    const response = await loginPOST(req);

    expect(mockHashPassword).toHaveBeenCalledWith("firsttimepassword");
    expect(mockAdminCreate).toHaveBeenCalledWith({
      data: { passwordHash: "$2a$12$newhash" },
    });
    expect(response.status).toBe(200);
  });

  it("creates a Session record in the database", async () => {
    const req = makeRequest({ password: "validpassword" });
    await loginPOST(req);

    expect(mockSessionCreate).toHaveBeenCalledWith({
      data: {
        tokenHash: "sha256hash",
        adminId: "admin-1",
        expiresAt: expect.any(Date),
      },
    });
  });

  it("cleans up expired sessions after login", async () => {
    const req = makeRequest({ password: "validpassword" });
    await loginPOST(req);

    expect(mockCleanExpiredSessions).toHaveBeenCalled();
  });

  it("generates a session token and hashes it", async () => {
    const req = makeRequest({ password: "validpassword" });
    await loginPOST(req);

    expect(mockGenerateSessionToken).toHaveBeenCalledTimes(1);
    expect(mockHashToken).toHaveBeenCalledWith("abc123token");
  });

  it("returns 500 on unexpected error", async () => {
    mockAdminFindFirst.mockRejectedValue(new Error("DB connection lost"));

    const req = makeRequest({ password: "validpassword" });
    const response = await loginPOST(req);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Internal server error");
  });

  it("handles non-JSON body gracefully", async () => {
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });

    const response = await loginPOST(req);
    // req.json() throws, caught by handleApiError → 500
    expect(response.status).toBe(500);
  });
});

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionDelete.mockResolvedValue({});
  });

  it("returns 200 and loggedOut:true", async () => {
    const req = makeRequest({});
    const response = await logoutPOST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.loggedOut).toBe(true);
  });

  it("deletes the session from the Session table by tokenHash", async () => {
    mockHashToken.mockResolvedValue("hashedtoken123");

    const req = new NextRequest("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    // Set cookie on request
    req.cookies.set("session_token", "my-token");

    await logoutPOST(req);

    expect(mockHashToken).toHaveBeenCalledWith("my-token");
    expect(mockSessionDelete).toHaveBeenCalledWith({
      where: { tokenHash: "hashedtoken123" },
    });
  });

  it("clears the session cookie (maxAge=0)", async () => {
    const req = makeRequest({});
    const response = await logoutPOST(req);

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("session_token=");
    expect(setCookieHeader).toContain("Max-Age=0");
  });

  it("sets HttpOnly and SameSite=strict on cleared cookie", async () => {
    const req = makeRequest({});
    const response = await logoutPOST(req);

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=strict");
  });

  it("succeeds even if session does not exist in DB (delete catches)", async () => {
    mockSessionDelete.mockRejectedValue(new Error("Record not found"));

    const req = makeRequest({});
    const response = await logoutPOST(req);
    const body = await response.json();

    // The route catches the delete error and still returns ok
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: withAuth passes — verifySession returns a valid session
    mockVerifySession.mockResolvedValue({
      id: "session-1",
      adminId: "admin-1",
    });
    mockAdminFindFirst.mockResolvedValue({
      id: "admin-1",
      passwordHash: "$2a$12$oldhash",
    });
    mockVerifyPassword.mockResolvedValue(true);
    mockHashPassword.mockResolvedValue("$2a$12$newhash");
    mockAdminUpdate.mockResolvedValue({ id: "admin-1", passwordHash: "$2a$12$newhash" });
  });

  it("returns 401 when no session cookie is present", async () => {
    mockVerifySession.mockResolvedValue(null);

    const req = makeUnauthedRequest({
      currentPassword: "oldpass",
      newPassword: "newpass123",
    });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when session token is invalid", async () => {
    mockVerifySession.mockResolvedValue(null);

    const req = makeRequest({
      currentPassword: "oldpass",
      newPassword: "newpass123",
    });
    const response = await changePasswordPOST(req, undefined);

    expect(response.status).toBe(401);
  });

  it("returns 400 when currentPassword is missing", async () => {
    const req = makeRequest({ newPassword: "newpassword123" });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid input");
  });

  it("returns 400 when newPassword is less than 8 characters", async () => {
    const req = makeRequest({
      currentPassword: "currentpass",
      newPassword: "short",
    });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid input");
  });

  it("returns 400 when both fields are missing", async () => {
    const req = makeRequest({});
    const response = await changePasswordPOST(req, undefined);

    expect(response.status).toBe(400);
  });

  it("returns 401 when current password is incorrect", async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const req = makeRequest({
      currentPassword: "wrongcurrent",
      newPassword: "newpassword123",
    });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Current password is incorrect");
  });

  it("returns 401 when admin account not found", async () => {
    mockAdminFindFirst.mockResolvedValue(null);

    const req = makeRequest({
      currentPassword: "currentpass",
      newPassword: "newpassword123",
    });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("No admin account found");
  });

  it("updates password on valid request", async () => {
    const req = makeRequest({
      currentPassword: "validcurrent",
      newPassword: "newpassword123",
    });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.changed).toBe(true);
  });

  it("hashes the new password and updates the admin record", async () => {
    const req = makeRequest({
      currentPassword: "validcurrent",
      newPassword: "newpassword123",
    });
    await changePasswordPOST(req, undefined);

    expect(mockHashPassword).toHaveBeenCalledWith("newpassword123");
    expect(mockAdminUpdate).toHaveBeenCalledWith({
      where: { id: "admin-1" },
      data: { passwordHash: "$2a$12$newhash" },
    });
  });

  it("returns 500 on unexpected error", async () => {
    mockAdminFindFirst.mockRejectedValue(new Error("DB error"));

    const req = makeRequest({
      currentPassword: "currentpass",
      newPassword: "newpassword123",
    });
    const response = await changePasswordPOST(req, undefined);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Internal server error");
  });
});
