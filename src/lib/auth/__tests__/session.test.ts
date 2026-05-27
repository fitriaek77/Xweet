// Tests for src/lib/auth/session.ts
import { describe, it, expect } from "vitest";
import { generateSessionToken, hashToken, verifyPassword, hashPassword } from "@/lib/auth/session";

describe("generateSessionToken", () => {
  it("generates a hex string", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("generates a 64-char hex string (32 bytes)", () => {
    const token = generateSessionToken();
    expect(token.length).toBe(64);
  });

  it("generates unique tokens", () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();
    expect(token1).not.toBe(token2);
  });
});

describe("hashToken", () => {
  it("produces a SHA-256 hex hash", async () => {
    const hash = await hashToken("test-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces consistent hash for same input", async () => {
    const hash1 = await hashToken("test-token");
    const hash2 = await hashToken("test-token");
    expect(hash1).toBe(hash2);
  });

  it("produces different hash for different input", async () => {
    const hash1 = await hashToken("token1");
    const hash2 = await hashToken("token2");
    expect(hash1).not.toBe(hash2);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifies it", async () => {
    const hash = await hashPassword("mypassword");
    expect(hash).not.toBe("mypassword");
    const isValid = await verifyPassword("mypassword", hash);
    expect(isValid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("mypassword");
    const isValid = await verifyPassword("wrongpassword", hash);
    expect(isValid).toBe(false);
  });

  it("produces different hashes for same password (salt)", async () => {
    const hash1 = await hashPassword("samepassword");
    const hash2 = await hashPassword("samepassword");
    expect(hash1).not.toBe(hash2); // Different salts
  });
});
