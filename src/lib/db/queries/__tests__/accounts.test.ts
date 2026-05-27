// Tests for src/lib/db/queries/accounts.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/lib/api/errors";

// ─── Hoisted mock functions ───
const { mockFindMany, mockFindUnique, mockCreate, mockUpdate, mockDelete } =
  vi.hoisted(() => ({
    mockFindMany: vi.fn(),
    mockFindUnique: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
  }));

vi.mock("@/lib/db/db", () => ({
  db: {
    account: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

// Import after mocks are set up
import {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  incrementFailureCount,
  resetFailureCount,
  openCircuit,
} from "@/lib/db/queries/accounts";

// ─── Shared fixtures ───
const fakeAccount = {
  id: "acc-1",
  username: "testuser",
  displayName: "Test User",
  avatarUrl: "https://x.com/avatar.jpg",
  encryptedCookies: "enc:cookies",
  isActive: true,
  failureCount: 0,
  circuitOpenUntil: null,
  lastPostedAt: null,
  lastCt0RefreshAt: null,
  cookieUpdatedAt: null,
  createdAt: new Date("2025-01-01T09:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getAccounts ───
describe("getAccounts", () => {
  it("returns all accounts ordered by createdAt desc", async () => {
    mockFindMany.mockResolvedValue([fakeAccount]);
    const result = await getAccounts();
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        isActive: true,
        failureCount: true,
        circuitOpenUntil: true,
        lastPostedAt: true,
        lastCt0RefreshAt: true,
        createdAt: true,
      },
    });
    expect(result).toEqual([fakeAccount]);
  });

  it("returns empty array when no accounts", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await getAccounts();
    expect(result).toEqual([]);
  });
});

// ─── getAccountById ───
describe("getAccountById", () => {
  it("returns account when found", async () => {
    mockFindUnique.mockResolvedValue(fakeAccount);
    const result = await getAccountById("acc-1");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "acc-1" } });
    expect(result).toEqual(fakeAccount);
  });

  it("throws NotFoundError when account not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(getAccountById("nonexistent")).rejects.toThrow(NotFoundError);
    await expect(getAccountById("nonexistent")).rejects.toThrow(
      "Account not found: nonexistent"
    );
  });
});

// ─── createAccount ───
describe("createAccount", () => {
  it("creates and returns a new account", async () => {
    const data = {
      username: "newuser",
      encryptedCookies: "enc:new",
      displayName: "New User",
    };
    const created = { ...fakeAccount, ...data };
    mockCreate.mockResolvedValue(created);

    const result = await createAccount(data);
    expect(mockCreate).toHaveBeenCalledWith({ data });
    expect(result).toEqual(created);
  });

  it("creates account with optional fields", async () => {
    const data = {
      username: "newuser",
      encryptedCookies: "enc:new",
      displayName: "New User",
      userId: "user-123",
      avatarUrl: "https://x.com/new-avatar.jpg",
    };
    mockCreate.mockResolvedValue({ ...fakeAccount, ...data });
    const result = await createAccount(data);
    expect(mockCreate).toHaveBeenCalledWith({ data });
    expect(result.username).toBe("newuser");
  });
});

// ─── updateAccount ───
describe("updateAccount", () => {
  it("updates account when found", async () => {
    const updateData = { displayName: "Updated Name" };
    const updated = { ...fakeAccount, ...updateData };
    mockFindUnique.mockResolvedValue(fakeAccount);
    mockUpdate.mockResolvedValue(updated);

    const result = await updateAccount("acc-1", updateData);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "acc-1" } });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: updateData,
    });
    expect(result).toEqual(updated);
  });

  it("throws NotFoundError when account not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      updateAccount("nonexistent", { displayName: "X" })
    ).rejects.toThrow(NotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates isActive field", async () => {
    const updateData = { isActive: false };
    const updated = { ...fakeAccount, ...updateData };
    mockFindUnique.mockResolvedValue(fakeAccount);
    mockUpdate.mockResolvedValue(updated);

    const result = await updateAccount("acc-1", updateData);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: updateData,
    });
    expect(result.isActive).toBe(false);
  });
});

// ─── deleteAccount ───
describe("deleteAccount", () => {
  it("deletes account when found", async () => {
    mockFindUnique.mockResolvedValue(fakeAccount);
    mockDelete.mockResolvedValue(fakeAccount);

    const result = await deleteAccount("acc-1");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "acc-1" } });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "acc-1" } });
    expect(result).toEqual(fakeAccount);
  });

  it("throws NotFoundError when account not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(deleteAccount("nonexistent")).rejects.toThrow(NotFoundError);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// ─── incrementFailureCount ───
describe("incrementFailureCount", () => {
  it("increments failureCount by 1", async () => {
    const updated = { ...fakeAccount, failureCount: 1 };
    mockUpdate.mockResolvedValue(updated);

    const result = await incrementFailureCount("acc-1");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { failureCount: { increment: 1 } },
    });
    expect(result.failureCount).toBe(1);
  });

  it("does not check if account exists (delegated to Prisma)", async () => {
    mockUpdate.mockResolvedValue({ ...fakeAccount, failureCount: 3 });
    await incrementFailureCount("acc-1");
    // incrementFailureCount does not call findUnique first — it goes straight to update
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

// ─── resetFailureCount ───
describe("resetFailureCount", () => {
  it("sets failureCount to 0 and clears circuitOpenUntil", async () => {
    const updated = { ...fakeAccount, failureCount: 0, circuitOpenUntil: null };
    mockUpdate.mockResolvedValue(updated);

    const result = await resetFailureCount("acc-1");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { failureCount: 0, circuitOpenUntil: null },
    });
    expect(result.failureCount).toBe(0);
    expect(result.circuitOpenUntil).toBeNull();
  });
});

// ─── openCircuit ───
describe("openCircuit", () => {
  it("sets circuitOpenUntil and resets failureCount to 0", async () => {
    const cooldownUntil = new Date("2025-01-01T12:30:00Z");
    const updated = {
      ...fakeAccount,
      failureCount: 0,
      circuitOpenUntil: cooldownUntil,
    };
    mockUpdate.mockResolvedValue(updated);

    const result = await openCircuit("acc-1", cooldownUntil);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { failureCount: 0, circuitOpenUntil: cooldownUntil },
    });
    expect(result.failureCount).toBe(0);
    expect(result.circuitOpenUntil).toEqual(cooldownUntil);
  });

  it("uses the provided cooldown date", async () => {
    const cooldownUntil = new Date("2025-06-01T00:00:00Z");
    mockUpdate.mockResolvedValue({
      ...fakeAccount,
      circuitOpenUntil: cooldownUntil,
    });

    await openCircuit("acc-1", cooldownUntil);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ circuitOpenUntil: cooldownUntil }),
      })
    );
  });
});
