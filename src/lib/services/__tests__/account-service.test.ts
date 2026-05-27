// Tests for src/lib/services/account-service.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/queries/accounts", () => ({
  getAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock("@/lib/services/encryption-service", () => ({
  encryptAndStoreCookies: vi.fn(),
  decryptCookies: vi.fn(),
}));

vi.mock("@/lib/utils/crypto", () => ({
  encrypt: vi.fn(),
}));

vi.mock("@/lib/twitter/ct0-refresh", () => ({
  refreshCt0: vi.fn(),
  parseCookieString: vi.fn(),
}));

vi.mock("@/lib/twitter/circuit-breaker", () => ({
  getCircuitState: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  closeCircuit: vi.fn(),
}));

vi.mock("@/lib/db/queries/logs", () => ({
  createLog: vi.fn(),
}));

import {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
} from "@/lib/db/queries/accounts";
import {
  encryptAndStoreCookies,
  decryptCookies,
} from "@/lib/services/encryption-service";
import { encrypt } from "@/lib/utils/crypto";
import { refreshCt0, parseCookieString } from "@/lib/twitter/ct0-refresh";
import { recordSuccess, recordFailure } from "@/lib/twitter/circuit-breaker";
import { createLog } from "@/lib/db/queries/logs";
import {
  listAccounts,
  getAccount,
  addAccount,
  modifyAccount,
  removeAccount,
  getDecryptedCookies,
  verifyAccount,
  refreshAccountCt0,
} from "@/lib/services/account-service";
import { NotFoundError, ValidationError } from "@/lib/api/errors";

describe("account-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── listAccounts ───

  describe("listAccounts", () => {
    it("delegates to getAccounts", async () => {
      const accounts = [{ id: "1", username: "user1" }];
      vi.mocked(getAccounts).mockResolvedValue(accounts as never);

      const result = await listAccounts();

      expect(result).toBe(accounts);
      expect(getAccounts).toHaveBeenCalledOnce();
    });
  });

  // ─── getAccount ───

  describe("getAccount", () => {
    it("delegates to getAccountById", async () => {
      const account = { id: "1", username: "user1" };
      vi.mocked(getAccountById).mockResolvedValue(account as never);

      const result = await getAccount("1");

      expect(result).toBe(account);
      expect(getAccountById).toHaveBeenCalledWith("1");
    });

    it("propagates NotFoundError from getAccountById", async () => {
      vi.mocked(getAccountById).mockRejectedValue(
        new NotFoundError("Account", "1")
      );

      await expect(getAccount("1")).rejects.toThrow(NotFoundError);
    });
  });

  // ─── addAccount ───

  describe("addAccount", () => {
    it("throws ValidationError if cookies don't have auth_token and ct0", async () => {
      vi.mocked(parseCookieString).mockReturnValue(null);

      await expect(
        addAccount({ username: "user1", cookies: "bad=cookies" })
      ).rejects.toThrow(ValidationError);

      await expect(
        addAccount({ username: "user1", cookies: "bad=cookies" })
      ).rejects.toThrow("Invalid cookie format");
    });

    it("encrypts cookies immediately at write time (no PLAINTEXT prefix)", async () => {
      const rawCookies = "auth_token=abc; ct0=def; twid=ghi";
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(encrypt).mockReturnValue("enc:val:ue");
      vi.mocked(createAccount).mockResolvedValue({
        id: "acct-1",
        username: "user1",
      } as never);

      const result = await addAccount({
        username: "user1",
        cookies: rawCookies,
        displayName: "User One",
      });

      // Encrypts immediately — no {PLAINTEXT} prefix
      expect(encrypt).toHaveBeenCalledWith(rawCookies);
      expect(createAccount).toHaveBeenCalledWith({
        username: "user1",
        encryptedCookies: "enc:val:ue",
        displayName: "User One",
      });

      // Does NOT call encryptAndStoreCookies (already encrypted in createAccount)
      expect(encryptAndStoreCookies).not.toHaveBeenCalled();

      // Logs the creation
      expect(createLog).toHaveBeenCalledWith({
        accountId: "acct-1",
        action: "create",
        detail: "Account @user1 added",
      });

      expect(result).toEqual({ id: "acct-1", username: "user1" });
    });

    it("works without displayName", async () => {
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "",
      });
      vi.mocked(encrypt).mockReturnValue("enc:val:ue");
      vi.mocked(createAccount).mockResolvedValue({
        id: "acct-2",
        username: "user2",
      } as never);

      await addAccount({ username: "user2", cookies: "auth_token=abc; ct0=def" });

      expect(createAccount).toHaveBeenCalledWith({
        username: "user2",
        encryptedCookies: "enc:val:ue",
        displayName: undefined,
      });
    });
  });

  // ─── modifyAccount ───

  describe("modifyAccount", () => {
    it("validates cookies if provided and throws ValidationError", async () => {
      vi.mocked(parseCookieString).mockReturnValue(null);

      await expect(
        modifyAccount("acct-1", { cookies: "invalid" })
      ).rejects.toThrow(ValidationError);
    });

    it("encrypts cookies when provided", async () => {
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "",
      });
      vi.mocked(updateAccount).mockResolvedValue({ id: "acct-1" } as never);

      await modifyAccount("acct-1", { cookies: "auth_token=abc; ct0=def" });

      expect(encryptAndStoreCookies).toHaveBeenCalledWith(
        "acct-1",
        "auth_token=abc; ct0=def"
      );
      expect(updateAccount).toHaveBeenCalledWith("acct-1", {});
    });

    it("updates display name and isActive without cookies", async () => {
      vi.mocked(updateAccount).mockResolvedValue({ id: "acct-1" } as never);

      await modifyAccount("acct-1", {
        displayName: "New Name",
        isActive: false,
      });

      expect(encryptAndStoreCookies).not.toHaveBeenCalled();
      expect(updateAccount).toHaveBeenCalledWith("acct-1", {
        displayName: "New Name",
        isActive: false,
      });
    });
  });

  // ─── removeAccount ───

  describe("removeAccount", () => {
    it("deletes account and logs", async () => {
      vi.mocked(deleteAccount).mockResolvedValue({ id: "acct-1" } as never);

      await removeAccount("acct-1");

      expect(deleteAccount).toHaveBeenCalledWith("acct-1");
      expect(createLog).toHaveBeenCalledWith({
        accountId: "acct-1",
        action: "cancel",
        detail: "Account removed",
      });
    });
  });

  // ─── getDecryptedCookies ───

  describe("getDecryptedCookies", () => {
    it("returns decrypted cookies", async () => {
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");

      const result = await getDecryptedCookies("acct-1");

      expect(result).toBe("auth_token=abc; ct0=def");
    });

    it("throws NotFoundError when account not found (null cookies)", async () => {
      vi.mocked(decryptCookies).mockResolvedValue(null);

      await expect(getDecryptedCookies("nonexistent")).rejects.toThrow(
        NotFoundError
      );
    });
  });

  // ─── verifyAccount ───

  describe("verifyAccount", () => {
    it("returns invalid when cookies cannot be parsed", async () => {
      vi.mocked(decryptCookies).mockResolvedValue("bad-cookies");
      vi.mocked(parseCookieString).mockReturnValue(null);

      const result = await verifyAccount("acct-1");

      expect(result).toEqual({
        valid: false,
        error: "Cannot parse cookies",
      });
    });

    it("returns valid when ct0 refresh succeeds", async () => {
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "ghi",
      });
      vi.mocked(refreshCt0).mockResolvedValue({
        ct0: "new-ct0",
        twid: "new-twid",
        ct0MaxAge: 10800,
      });

      const result = await verifyAccount("acct-1");

      expect(result).toEqual({
        valid: true,
        ct0: "new-ct0",
        twid: "new-twid",
      });

      // Should encrypt updated cookies and record success
      expect(encryptAndStoreCookies).toHaveBeenCalledWith(
        "acct-1",
        "auth_token=abc; ct0=def"
      );
      expect(recordSuccess).toHaveBeenCalledWith("acct-1");
    });

    it("returns invalid when ct0 refresh fails (null result)", async () => {
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "",
      });
      vi.mocked(refreshCt0).mockResolvedValue(null);

      const result = await verifyAccount("acct-1");

      expect(result).toEqual({
        valid: false,
        error: "ct0 refresh failed (timeout or network)",
      });
      expect(recordFailure).toHaveBeenCalledWith("acct-1");
    });

    it("records failure when ct0MaxAge < 0 (auth_token expired)", async () => {
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "",
      });
      vi.mocked(refreshCt0).mockResolvedValue({
        ct0: "ct0-val",
        twid: "twid-val",
        ct0MaxAge: -1,
      });

      const result = await verifyAccount("acct-1");

      expect(result).toEqual({
        valid: false,
        error: "auth_token expired (ct0 Max-Age < 0) — re-paste cookies",
      });
      expect(recordFailure).toHaveBeenCalledWith("acct-1");
      expect(recordSuccess).not.toHaveBeenCalled();
    });
  });

  // ─── refreshAccountCt0 ───

  describe("refreshAccountCt0", () => {
    it("logs success when ct0 refresh succeeds", async () => {
      // verifyAccount internally calls decryptCookies and parseCookieString
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "",
      });
      vi.mocked(refreshCt0).mockResolvedValue({
        ct0: "new-ct0",
        twid: "new-twid",
        ct0MaxAge: 10800,
      });

      const result = await refreshAccountCt0("acct-1");

      expect(result).toEqual({ success: true, ct0: "new-ct0" });
      expect(createLog).toHaveBeenCalledWith({
        accountId: "acct-1",
        action: "ct0_refresh",
        detail: "ct0 refreshed successfully",
      });
    });

    it("logs failure when ct0 refresh fails", async () => {
      vi.mocked(decryptCookies).mockResolvedValue("auth_token=abc; ct0=def");
      vi.mocked(parseCookieString).mockReturnValue({
        authToken: "abc",
        ct0: "def",
        twid: "",
      });
      vi.mocked(refreshCt0).mockResolvedValue(null);

      const result = await refreshAccountCt0("acct-1");

      expect(result).toEqual({
        success: false,
        error: "ct0 refresh failed (timeout or network)",
      });
      expect(createLog).toHaveBeenCalledWith({
        accountId: "acct-1",
        action: "ct0_refresh",
        detail: "ct0 refresh failed: ct0 refresh failed (timeout or network)",
      });
    });
  });
});
