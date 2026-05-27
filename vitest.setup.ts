// vitest.setup.ts
// Global test setup — set required env vars before any imports.
// Reads real DB credentials from .env (loaded by dotenv in vitest.config.ts).
// Falls back to dummy values so tests don't crash if .env is missing.

// DB: prefer real credentials from .env, fall back to dummy for CI/local
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?sslmode=disable";
process.env.DATABASE_URL_UNPOOLED =
  process.env.DATABASE_URL_UNPOOLED || "postgresql://test:test@localhost:5432/test?sslmode=disable";
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Test-deterministic values: always override so tests are predictable
process.env.ADMIN_PASSWORD = "testpassword123";
process.env.CRON_SECRET = "test-cron-secret";
// NODE_ENV is readonly in Vitest — vitest automatically sets it to "test"
