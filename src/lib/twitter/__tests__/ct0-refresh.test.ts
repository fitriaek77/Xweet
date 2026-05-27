// Tests for src/lib/twitter/ct0-refresh.ts (all functions)
/** Safely get nth mock call without non-null assertion. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseCookieString,
  updateCt0InCookieString,
  refreshCt0,
} from "@/lib/twitter/ct0-refresh";

describe("parseCookieString", () => {
  it("extracts auth_token, ct0, and twid from cookie string", () => {
    const result = parseCookieString("auth_token=abc123; ct0=def456; twid=ghi789");
    expect(result).toEqual({
      authToken: "abc123",
      ct0: "def456",
      twid: "ghi789",
    });
  });

  it("returns null if auth_token is missing", () => {
    expect(parseCookieString("ct0=def456; twid=ghi789")).toBeNull();
  });

  it("returns null if ct0 is missing", () => {
    expect(parseCookieString("auth_token=abc123; twid=ghi789")).toBeNull();
  });

  it("returns empty twid if not present", () => {
    expect(parseCookieString("auth_token=abc123; ct0=def456")).toEqual({
      authToken: "abc123",
      ct0: "def456",
      twid: "",
    });
  });

  it("handles cookies with values containing equals signs", () => {
    expect(parseCookieString("auth_token=abc=123; ct0=def")?.authToken).toBe("abc=123");
  });

  it("handles extra whitespace", () => {
    expect(parseCookieString("  auth_token = abc ;  ct0 = def  ")).toEqual({
      authToken: "abc",
      ct0: "def",
      twid: "",
    });
  });

  it("returns null for empty string", () => {
    expect(parseCookieString("")).toBeNull();
  });
});

describe("updateCt0InCookieString", () => {
  it("replaces ct0 in cookie string", () => {
    const result = updateCt0InCookieString("auth_token=abc; ct0=old; twid=xyz", "new_ct0");
    expect(result).toContain("ct0=new_ct0");
    expect(result).toContain("auth_token=abc");
    expect(result).not.toContain("ct0=old");
  });

  it("adds ct0 if not present", () => {
    const result = updateCt0InCookieString("auth_token=abc", "new_ct0");
    expect(result).toContain("ct0=new_ct0");
    expect(result).toContain("auth_token=abc");
  });

  it("replaces twid when provided", () => {
    const result = updateCt0InCookieString(
      "auth_token=abc; ct0=old; twid=old_twid",
      "new_ct0",
      "new_twid"
    );
    expect(result).toContain("ct0=new_ct0");
    expect(result).toContain("twid=new_twid");
    expect(result).not.toContain("twid=old_twid");
  });

  it("does not replace twid when not provided", () => {
    const result = updateCt0InCookieString("auth_token=abc; ct0=old; twid=old_twid", "new_ct0");
    expect(result).toContain("twid=old_twid");
  });
});

describe("refreshCt0", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await refreshCt0("test_auth_token");
    expect(result).toBeNull();
  });

  it("returns null on timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "AbortError")));
    const result = await refreshCt0("test_auth_token");
    expect(result).toBeNull();
  });

  it("parses ct0 and twid from Set-Cookie headers", async () => {
    const mockResponse = {
      status: 200,
      headers: {
        getSetCookie: () => [
          "ct0=abcdef123456; Max-Age=10800; Path=/; Secure",
          "twid=u%3D1234567890; Path=/; Secure",
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).not.toBeNull();
    if (!result) throw new Error("unexpected null");
    expect(result.ct0).toBe("abcdef123456");
    expect(result.twid).toBe("u%3D1234567890");
    expect(result.ct0MaxAge).toBe(10800);
  });

  it("returns null when no ct0 in Set-Cookie headers", async () => {
    const mockResponse = {
      status: 200,
      headers: {
        getSetCookie: () => ["twid=u%3D1234567890; Path=/; Secure"],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).toBeNull();
  });

  it("handles ct0 without twid", async () => {
    const mockResponse = {
      status: 200,
      headers: {
        getSetCookie: () => ["ct0=abcdef123456; Max-Age=10800; Path=/; Secure"],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).not.toBeNull();
    if (!result) throw new Error("unexpected null");
    expect(result.ct0).toBe("abcdef123456");
    expect(result.twid).toBe("");
  });

  it("handles ct0 with negative Max-Age (expired)", async () => {
    const mockResponse = {
      status: 200,
      headers: {
        getSetCookie: () => ["ct0=abcdef123456; Max-Age=-1; Path=/; Secure"],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).not.toBeNull();
    if (!result) throw new Error("unexpected null");
    expect(result.ct0MaxAge).toBe(-1);
  });

  it("handles ct0 with no Max-Age attribute", async () => {
    const mockResponse = {
      status: 200,
      headers: {
        getSetCookie: () => ["ct0=abcdef123456; Path=/; Secure"],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).not.toBeNull();
    if (!result) throw new Error("unexpected null");
    expect(result.ct0MaxAge).toBe(0);
  });

  it("sends auth_token as Cookie header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: { getSetCookie: () => ["ct0=abc; Max-Age=100"] },
    });
    vi.stubGlobal("fetch", fetchMock);
    await refreshCt0("my_auth_token_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callOpts = fetchMock.mock.calls.at(0);
    if (!callOpts) throw new Error("No mock call found");
    expect(callOpts[1]?.headers).toHaveProperty("Cookie", "auth_token=my_auth_token_123");
  });

  it("returns null for empty Set-Cookie headers", async () => {
    const mockResponse = {
      status: 200,
      headers: { getSetCookie: () => [] },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).toBeNull();
  });

  it("handles multiple cookies in Set-Cookie", async () => {
    const mockResponse = {
      status: 200,
      headers: {
        getSetCookie: () => [
          "guest_id=v1%3A123; Max-Age=34214400; Path=/",
          "ct0=freshct0token; Max-Age=10800; Path=/; Secure; HttpOnly",
          "twid=u%3D999; Path=/; Secure",
          "kdt=abc; Max-Age=34214400; Path=/",
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await refreshCt0("test_auth_token");
    expect(result).not.toBeNull();
    if (!result) throw new Error("unexpected null");
    expect(result.ct0).toBe("freshct0token");
    expect(result.twid).toBe("u%3D999");
    expect(result.ct0MaxAge).toBe(10800);
  });
});
