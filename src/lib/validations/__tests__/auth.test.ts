// Tests for src/lib/validations/auth.ts
import { describe, it, expect } from "vitest";
import { loginSchema, changePasswordSchema } from "@/lib/validations/auth";

describe("loginSchema", () => {
  it("validates valid login data", () => {
    const result = loginSchema.safeParse({ password: "mypassword" });
    expect(result.success).toBe(true);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({ password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("validates valid change password data", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "oldpass123",
      newPassword: "newpass456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty currentPassword", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: "newpass456",
    });
    expect(result.success).toBe(false);
  });

  it("rejects newPassword shorter than 8 chars", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "oldpass123",
      newPassword: "short7",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result1 = changePasswordSchema.safeParse({ currentPassword: "old" });
    expect(result1.success).toBe(false);

    const result2 = changePasswordSchema.safeParse({ newPassword: "newpassword" });
    expect(result2.success).toBe(false);
  });
});
