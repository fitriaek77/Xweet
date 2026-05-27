// Tests for src/lib/services/encryption-service.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@/lib/utils/crypto", () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  isEncrypted: vi.fn(),
}));

vi.mock("@/lib/db/db", () => ({
  db: {
    account: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { encrypt, decrypt, isEncrypted } from "@/lib/utils/crypto";
import { db } from "@/lib/db/db";
import { encryptAndStoreCookies, decryptCookies } from "@/lib/services/encryption-service";

describe("encryption-service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── encryptAndStoreCookies ───

  describe("encryptAndStoreCookies", () => {
    it("encrypts raw cookies and updates DB", async () => {
      vi.mocked(encrypt).mockReturnValue("enc:val:ue");

      await encryptAndStoreCookies("acct-1", "raw-cookie-string");

      expect(encrypt).toHaveBeenCalledWith("raw-cookie-string");
      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: "acct-1" },
        data: {
          encryptedCookies: "enc:val:ue",
          cookieUpdatedAt: expect.any(Date),
        },
      });
    });

    it("propagates errors from encrypt", async () => {
      vi.mocked(encrypt).mockImplementation(() => {
        throw new Error("ENCRYPTION_KEY missing");
      });

      await expect(
        encryptAndStoreCookies("acct-1", "raw")
      ).rejects.toThrow("ENCRYPTION_KEY missing");

      expect(db.account.update).not.toHaveBeenCalled();
    });

    it("propagates errors from DB update", async () => {
      vi.mocked(encrypt).mockReturnValue("enc:val:ue");
      vi.mocked(db.account.update).mockRejectedValue(new Error("DB error"));

      await expect(
        encryptAndStoreCookies("acct-1", "raw")
      ).rejects.toThrow("DB error");
    });
  });

  // ─── decryptCookies ───

  describe("decryptCookies", () => {
    it("returns null for non-existent account", async () => {
      vi.mocked(db.account.findUnique).mockResolvedValue(null);

      const result = await decryptCookies("nonexistent");

      expect(result).toBeNull();
      expect(decrypt).not.toHaveBeenCalled();
      expect(encrypt).not.toHaveBeenCalled();
    });

    it("decrypts already-encrypted value", async () => {
      vi.mocked(db.account.findUnique).mockResolvedValue({
        id: "acct-1",
        username: "testuser",
        displayName: null,
        userId: null,
        avatarUrl: null,
        encryptedCookies: "iv:tag:ciphertext",
        isActive: true,
        lastPostedAt: null,
        lastCt0RefreshAt: null,
        cookieUpdatedAt: null,
        failureCount: 0,
        circuitOpenUntil: null,
        lastFailureAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(isEncrypted).mockReturnValue(true);
      vi.mocked(decrypt).mockReturnValue("decrypted-cookies");

      const result = await decryptCookies("acct-1");

      expect(result).toBe("decrypted-cookies");
      expect(decrypt).toHaveBeenCalledWith("iv:tag:ciphertext");
      // Should NOT re-encrypt or update DB
      expect(encrypt).not.toHaveBeenCalled();
      expect(db.account.update).not.toHaveBeenCalled();
    });

    it("throws error for unencrypted (plaintext) cookies", async () => {
      vi.mocked(db.account.findUnique).mockResolvedValue({
        id: "acct-1",
        username: "testuser",
        displayName: null,
        userId: null,
        avatarUrl: null,
        encryptedCookies: "{PLAINTEXT}my-raw-cookies",
        isActive: true,
        lastPostedAt: null,
        lastCt0RefreshAt: null,
        cookieUpdatedAt: null,
        failureCount: 0,
        circuitOpenUntil: null,
        lastFailureAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(isEncrypted).mockReturnValue(false);

      await expect(decryptCookies("acct-1")).rejects.toThrow(
        "unencrypted cookies"
      );
    });

    it("throws error for unprefixed plaintext cookies", async () => {
      vi.mocked(db.account.findUnique).mockResolvedValue({
        id: "acct-1",
        username: "testuser",
        displayName: null,
        userId: null,
        avatarUrl: null,
        encryptedCookies: "just-plain-cookies",
        isActive: true,
        lastPostedAt: null,
        lastCt0RefreshAt: null,
        cookieUpdatedAt: null,
        failureCount: 0,
        circuitOpenUntil: null,
        lastFailureAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(isEncrypted).mockReturnValue(false);

      await expect(decryptCookies("acct-1")).rejects.toThrow(
        "unencrypted cookies"
      );
    });
  });
});
