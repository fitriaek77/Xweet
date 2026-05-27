// Tests for src/lib/db/queries/settings.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock functions ───
const { mockFindUnique, mockUpsert, mockDelete, mockFindMany } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockUpsert: vi.fn(),
    mockDelete: vi.fn(),
    mockFindMany: vi.fn(),
  }));

vi.mock("@/lib/db/db", () => ({
  db: {
    setting: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      delete: mockDelete,
      findMany: mockFindMany,
    },
  },
}));

// Import after mocks are set up
import {
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
} from "@/lib/db/queries/settings";

// ─── Shared fixtures ───
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getSetting ───
describe("getSetting", () => {
  it("returns value when setting exists", async () => {
    mockFindUnique.mockResolvedValue({ key: "test_key", value: "test_value" });
    const result = await getSetting("test_key");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: "test_key" } });
    expect(result).toBe("test_value");
  });

  it("returns null when setting does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await getSetting("nonexistent");
    expect(result).toBeNull();
  });

  it("returns value unchanged (no PLAINTEXT stripping)", async () => {
    mockFindUnique.mockResolvedValue({
      key: "normal",
      value: "plain_value",
    });
    const result = await getSetting("normal");
    expect(result).toBe("plain_value");
  });
});

// ─── setSetting ───
describe("setSetting", () => {
  it("upserts a new setting", async () => {
    const created = { key: "new_key", value: "new_value" };
    mockUpsert.mockResolvedValue(created);

    const result = await setSetting("new_key", "new_value");
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "new_key" },
      update: { value: "new_value" },
      create: { key: "new_key", value: "new_value" },
    });
    expect(result).toEqual(created);
  });

  it("updates an existing setting", async () => {
    const updated = { key: "existing_key", value: "updated_value" };
    mockUpsert.mockResolvedValue(updated);

    const result = await setSetting("existing_key", "updated_value");
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "existing_key" },
      update: { value: "updated_value" },
      create: { key: "existing_key", value: "updated_value" },
    });
    expect(result).toEqual(updated);
  });
});

// ─── deleteSetting ───
describe("deleteSetting", () => {
  it("deletes a setting and returns it", async () => {
    const deleted = { key: "to_delete", value: "value" };
    mockDelete.mockResolvedValue(deleted);

    const result = await deleteSetting("to_delete");
    expect(mockDelete).toHaveBeenCalledWith({ where: { key: "to_delete" } });
    expect(result).toEqual(deleted);
  });

  it("returns null when setting not found (catches error)", async () => {
    mockDelete.mockRejectedValue(new Error("Record not found"));

    const result = await deleteSetting("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null on any deletion error", async () => {
    mockDelete.mockRejectedValue(new Error("Database error"));

    const result = await deleteSetting("problematic_key");
    expect(result).toBeNull();
  });
});

// ─── getAllSettings ───
describe("getAllSettings", () => {
  it("returns all settings ordered by key ascending", async () => {
    const settings = [
      { key: "alpha", value: "a" },
      { key: "beta", value: "b" },
      { key: "gamma", value: "c" },
    ];
    mockFindMany.mockResolvedValue(settings);

    const result = await getAllSettings();
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { key: "asc" } });
    expect(result).toEqual(settings);
  });

  it("returns empty array when no settings exist", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await getAllSettings();
    expect(result).toEqual([]);
  });
});
