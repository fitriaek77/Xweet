// Tests for src/lib/validations/account.ts
import { describe, it, expect } from "vitest";
import { createAccountSchema, updateAccountSchema } from "@/lib/validations/account";

describe("createAccountSchema", () => {
  it("validates valid account data", () => {
    const result = createAccountSchema.safeParse({
      username: "testuser",
      cookies: "auth_token=abc; ct0=def",
    });
    expect(result.success).toBe(true);
  });

  it("validates with optional displayName", () => {
    const result = createAccountSchema.safeParse({
      username: "testuser",
      cookies: "auth_token=abc",
      displayName: "Test User",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty username", () => {
    const result = createAccountSchema.safeParse({
      username: "",
      cookies: "auth_token=abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects username over 15 characters", () => {
    const result = createAccountSchema.safeParse({
      username: "a".repeat(16),
      cookies: "auth_token=abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects username with invalid characters", () => {
    const result = createAccountSchema.safeParse({
      username: "test-user!",
      cookies: "auth_token=abc",
    });
    expect(result.success).toBe(false);
  });

  it("allows underscore in username", () => {
    const result = createAccountSchema.safeParse({
      username: "test_user",
      cookies: "auth_token=abc",
    });
    expect(result.success).toBe(true);
  });

  it("allows numbers in username", () => {
    const result = createAccountSchema.safeParse({
      username: "user123",
      cookies: "auth_token=abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty cookies", () => {
    const result = createAccountSchema.safeParse({
      username: "testuser",
      cookies: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing username", () => {
    const result = createAccountSchema.safeParse({
      cookies: "auth_token=abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing cookies", () => {
    const result = createAccountSchema.safeParse({
      username: "testuser",
    });
    expect(result.success).toBe(false);
  });

  it("rejects displayName over 50 chars", () => {
    const result = createAccountSchema.safeParse({
      username: "testuser",
      cookies: "abc",
      displayName: "a".repeat(51),
    });
    expect(result.success).toBe(false);
  });
});

describe("updateAccountSchema", () => {
  it("validates partial update with displayName", () => {
    const result = updateAccountSchema.safeParse({
      displayName: "New Name",
    });
    expect(result.success).toBe(true);
  });

  it("validates partial update with cookies", () => {
    const result = updateAccountSchema.safeParse({
      cookies: "auth_token=new",
    });
    expect(result.success).toBe(true);
  });

  it("validates partial update with isActive", () => {
    const result = updateAccountSchema.safeParse({
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates empty object (no changes)", () => {
    const result = updateAccountSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects empty cookies string", () => {
    const result = updateAccountSchema.safeParse({
      cookies: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean isActive", () => {
    const result = updateAccountSchema.safeParse({
      isActive: "yes",
    });
    expect(result.success).toBe(false);
  });
});
