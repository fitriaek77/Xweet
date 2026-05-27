// Tests for src/lib/auth/dal.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock next/headers — cookies
const mockCookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (...args: unknown[]) => mockCookieGet(...args),
    })
  ),
}));

// Mock @/lib/db/db
const mockSessionFindUnique = vi.fn();
const mockSessionDelete = vi.fn();
const mockSessionDeleteMany = vi.fn();
const mockAdminCount = vi.fn();

vi.mock("@/lib/db/db", () => ({
  db: {
    session: {
      findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
      delete: (...args: unknown[]) => mockSessionDelete(...args),
      deleteMany: (...args: unknown[]) => mockSessionDeleteMany(...args),
    },
    admin: {
      count: (...args: unknown[]) => mockAdminCount(...args),
    },
  },
}));

// Mock @/lib/auth/session
const mockHashToken = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  hashToken: (...args: unknown[]) => mockHashToken(...args),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { verifySession, requireAuth, adminExists, cleanExpiredSessions } from "@/lib/auth/dal";
import { AuthError } from "@/lib/api/errors";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("verifySession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no session cookie is present", async () => {
    mockCookieGet.mockReturnValue(undefined);

    const session = await verifySession();

    expect(session).toBeNull();
  });

  it("returns null when session cookie value is empty", async () => {
    mockCookieGet.mockReturnValue({ value: "" });

    const session = await verifySession();

    expect(session).toBeNull();
  });

  it("returns null when no session found in DB", async () => {
    mockCookieGet.mockReturnValue({ value: "my-session-token" });
    mockHashToken.mockResolvedValue("hashedtoken123");
    mockSessionFindUnique.mockResolvedValue(null);

    const session = await verifySession();

    expect(session).toBeNull();
  });

  it("returns session with id and adminId when valid session found", async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockCookieGet.mockReturnValue({ value: "my-session-token" });
    mockHashToken.mockResolvedValue("hashedtoken123");
    mockSessionFindUnique.mockResolvedValue({
      id: "session-1",
      tokenHash: "hashedtoken123",
      adminId: "admin-1",
      expiresAt: futureDate,
    });

    const session = await verifySession();

    expect(session).toEqual({ id: "session-1", adminId: "admin-1" });
  });

  it("returns null and deletes expired session", async () => {
    const pastDate = new Date(Date.now() - 1000);
    mockCookieGet.mockReturnValue({ value: "my-session-token" });
    mockHashToken.mockResolvedValue("hashedtoken123");
    mockSessionFindUnique.mockResolvedValue({
      id: "session-expired",
      tokenHash: "hashedtoken123",
      adminId: "admin-1",
      expiresAt: pastDate,
    });
    mockSessionDelete.mockResolvedValue({});

    const session = await verifySession();

    expect(session).toBeNull();
    expect(mockSessionDelete).toHaveBeenCalledWith({
      where: { id: "session-expired" },
    });
  });

  it("passes the token to hashToken", async () => {
    mockCookieGet.mockReturnValue({ value: "my-session-token" });
    mockHashToken.mockResolvedValue("somehash");
    mockSessionFindUnique.mockResolvedValue(null);

    await verifySession();

    expect(mockHashToken).toHaveBeenCalledWith("my-session-token");
  });

  it("queries the Session table by tokenHash", async () => {
    mockCookieGet.mockReturnValue({ value: "my-session-token" });
    mockHashToken.mockResolvedValue("somehash");
    mockSessionFindUnique.mockResolvedValue(null);

    await verifySession();

    expect(mockSessionFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: "somehash" },
    });
  });
});

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when verification succeeds", async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockCookieGet.mockReturnValue({ value: "valid-token" });
    mockHashToken.mockResolvedValue("correct-hash");
    mockSessionFindUnique.mockResolvedValue({
      id: "session-1",
      tokenHash: "correct-hash",
      adminId: "admin-1",
      expiresAt: futureDate,
    });

    const session = await requireAuth();

    expect(session).toEqual({ id: "session-1", adminId: "admin-1" });
  });

  it("throws AuthError when no valid session", async () => {
    mockCookieGet.mockReturnValue(undefined);

    await expect(requireAuth()).rejects.toThrow(AuthError);
  });

  it("throws AuthError when session not found in DB", async () => {
    mockCookieGet.mockReturnValue({ value: "invalid-token" });
    mockHashToken.mockResolvedValue("wrong-hash");
    mockSessionFindUnique.mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow(AuthError);
  });

  it("AuthError has status code 401", async () => {
    mockCookieGet.mockReturnValue(undefined);

    try {
      await requireAuth();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).statusCode).toBe(401);
    }
  });
});

describe("adminExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when admin records exist (count > 0)", async () => {
    mockAdminCount.mockResolvedValue(1);

    const exists = await adminExists();

    expect(exists).toBe(true);
  });

  it("returns false when no admin records exist (count = 0)", async () => {
    mockAdminCount.mockResolvedValue(0);

    const exists = await adminExists();

    expect(exists).toBe(false);
  });

  it("returns true for multiple admin records", async () => {
    mockAdminCount.mockResolvedValue(3);

    const exists = await adminExists();

    expect(exists).toBe(true);
  });

  it("calls db.admin.count()", async () => {
    mockAdminCount.mockResolvedValue(0);

    await adminExists();

    expect(mockAdminCount).toHaveBeenCalled();
  });
});

describe("cleanExpiredSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes expired sessions and returns count", async () => {
    mockSessionDeleteMany.mockResolvedValue({ count: 3 });

    const count = await cleanExpiredSessions();

    expect(count).toBe(3);
    expect(mockSessionDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it("returns 0 when no expired sessions", async () => {
    mockSessionDeleteMany.mockResolvedValue({ count: 0 });

    const count = await cleanExpiredSessions();

    expect(count).toBe(0);
  });
});
