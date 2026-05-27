// Tests for src/config/env.ts
import { describe, it, expect } from "vitest";

// Note: getEnv() caches its result in _env, so once called it won't re-parse
// env vars. We test the basic functionality that works with the test setup.

describe("getEnv", () => {
  it("returns valid env with required DATABASE_URL", async () => {
    process.env.DATABASE_URL = "file:./test.db";
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    expect(env.DATABASE_URL).toBe("file:./test.db");
    expect(env.NODE_ENV).toBe("test");
  });

  it("accepts optional ENCRYPTION_KEY", async () => {
    process.env.DATABASE_URL = "file:./test.db";
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    delete process.env.ADMIN_PASSWORD;
    delete process.env.CRON_SECRET;

    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    expect(env.ENCRYPTION_KEY).toBe("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("returns object with correct shape", async () => {
    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    expect(env).toHaveProperty("DATABASE_URL");
    expect(env).toHaveProperty("NODE_ENV");
    expect(typeof env.DATABASE_URL).toBe("string");
    expect(typeof env.NODE_ENV).toBe("string");
  });

  it("has DATABASE_URL that is a non-empty string", async () => {
    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    expect(env.DATABASE_URL.length).toBeGreaterThan(0);
  });

  it("NODE_ENV is one of the valid values", async () => {
    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    expect(["development", "production", "test"]).toContain(env.NODE_ENV);
  });
});
