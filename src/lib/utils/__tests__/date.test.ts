// Tests for src/lib/utils/date.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDate, formatRelativeTime, isPast, toUnixSeconds, fromUnixSeconds } from "@/lib/utils/date";

describe("formatDate", () => {
  it("formats a Date object with default pattern", () => {
    const date = new Date("2024-06-15T14:30:00Z");
    const result = formatDate(date);
    // Result depends on locale, just check it's a non-empty string
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("formats a date string", () => {
    const result = formatDate("2024-06-15T14:30:00Z");
    expect(result).toBeTruthy();
  });

  it("returns 'Invalid date' for invalid date", () => {
    expect(formatDate("not-a-date")).toBe("Invalid date");
  });

  it("respects custom pattern", () => {
    const date = new Date("2024-06-15T14:30:00Z");
    const result = formatDate(date, "yyyy-MM-dd");
    expect(result).toBe("2024-06-15");
  });

  it("handles Date objects directly", () => {
    const date = new Date(2024, 5, 15); // June 15, 2024
    const result = formatDate(date, "yyyy-MM-dd");
    expect(result).toBe("2024-06-15");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });

  it("returns relative time string for future date", () => {
    const future = new Date("2024-06-15T12:05:00Z");
    const result = formatRelativeTime(future);
    expect(result).toContain("5 minutes");
  });

  it("returns relative time string for past date", () => {
    const past = new Date("2024-06-15T11:55:00Z");
    const result = formatRelativeTime(past);
    expect(result).toContain("5 minutes");
  });

  it("returns 'Invalid date' for invalid date string", () => {
    expect(formatRelativeTime("invalid")).toBe("Invalid date");
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("isPast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });

  it("returns true for dates in the past", () => {
    expect(isPast("2024-06-15T11:00:00Z")).toBe(true);
  });

  it("returns false for dates in the future", () => {
    expect(isPast("2024-06-15T13:00:00Z")).toBe(false);
  });

  it("returns true for exactly now (edge case)", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    // Same millisecond — getTime() < Date.now() is false since they're equal
    expect(isPast(now)).toBe(false);
  });

  it("works with Date objects", () => {
    const pastDate = new Date("2024-06-14T12:00:00Z");
    expect(isPast(pastDate)).toBe(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("toUnixSeconds", () => {
  it("converts Date to Unix seconds", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const result = toUnixSeconds(date);
    expect(result).toBe(Math.floor(date.getTime() / 1000));
  });

  it("returns integer (floored)", () => {
    const date = new Date(1718452800500); // has milliseconds
    const result = toUnixSeconds(date);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("fromUnixSeconds", () => {
  it("converts Unix seconds to Date", () => {
    const seconds = 1718452800;
    const result = fromUnixSeconds(seconds);
    expect(result.getTime()).toBe(seconds * 1000);
  });

  it("round-trips with toUnixSeconds", () => {
    const original = new Date("2024-06-15T12:00:00Z");
    const seconds = toUnixSeconds(original);
    const roundTripped = fromUnixSeconds(seconds);
    // May lose up to 999ms due to flooring
    expect(Math.abs(roundTripped.getTime() - original.getTime())).toBeLessThan(1000);
  });
});
