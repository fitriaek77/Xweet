// Tests for src/lib/utils/error-classifier.ts
import { describe, it, expect } from "vitest";
import { isTransientError } from "@/lib/utils/error-classifier";
import { TwitterApiError, AppError } from "@/lib/api/errors";

describe("isTransientError", () => {
  it("returns false for non-TwitterApiError errors", () => {
    expect(isTransientError(new Error("generic"))).toBe(false);
    expect(isTransientError(new AppError("app error", 500))).toBe(false);
    expect(isTransientError("string error")).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it("returns true for transient HTTP status 429", () => {
    const error = new TwitterApiError("rate limited", 429);
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient HTTP status 500", () => {
    const error = new TwitterApiError("internal error", 500);
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient HTTP status 502", () => {
    const error = new TwitterApiError("bad gateway", 502);
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient HTTP status 503", () => {
    const error = new TwitterApiError("service unavailable", 503);
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient HTTP status 504", () => {
    const error = new TwitterApiError("gateway timeout", 504);
    expect(isTransientError(error)).toBe(true);
  });

  it("returns false for non-transient HTTP statuses", () => {
    const error400 = new TwitterApiError("bad request", 400);
    const error401 = new TwitterApiError("unauthorized", 401);
    const error404 = new TwitterApiError("not found", 404);
    expect(isTransientError(error400)).toBe(false);
    expect(isTransientError(error401)).toBe(false);
    expect(isTransientError(error404)).toBe(false);
  });

  it("returns true for transient X error code 88 (rate limit)", () => {
    const error = new TwitterApiError("rate limit", 200, JSON.stringify({ errors: [{ code: 88, message: "Rate limit exceeded" }] }));
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient X error code 131 (internal error)", () => {
    const error = new TwitterApiError("internal", 200, JSON.stringify({ errors: [{ code: 131, message: "Internal error" }] }));
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient X error code 239", () => {
    const error = new TwitterApiError("bad guest token", 200, JSON.stringify({ errors: [{ code: 239, message: "Bad guest token" }] }));
    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for transient X error code 253", () => {
    const error = new TwitterApiError("json error", 200, JSON.stringify({ errors: [{ code: 253, message: "JSON parsing error" }] }));
    expect(isTransientError(error)).toBe(true);
  });

  it("returns false for non-transient X error codes", () => {
    const error = new TwitterApiError("not found", 200, JSON.stringify({ errors: [{ code: 144, message: "No status found" }] }));
    expect(isTransientError(error)).toBe(false);
  });

  it("returns false when detail is not valid JSON", () => {
    const error = new TwitterApiError("some error", 200, "not-json");
    expect(isTransientError(error)).toBe(false);
  });

  it("returns false when detail has no error code", () => {
    const error = new TwitterApiError("some error", 200, JSON.stringify({ message: "something" }));
    expect(isTransientError(error)).toBe(false);
  });

  it("handles top-level code in detail JSON", () => {
    const error = new TwitterApiError("rate limit", 200, JSON.stringify({ code: 88 }));
    expect(isTransientError(error)).toBe(true);
  });
});
