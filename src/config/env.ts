// src/config/env.ts
// Typed environment variables with Zod validation.
// In development, most vars are optional with sensible defaults.

import { z } from "zod/v4";

const envSchema = z.object({
  // Database — two connection strings for Neon
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_UNPOOLED: z.string().optional(), // Neon direct/unpooled connection (for Prisma CLI migrations)

  // Security
  ENCRYPTION_KEY: z.string().min(64, "ENCRYPTION_KEY must be 64 hex chars (32 bytes)").optional(),
  ADMIN_PASSWORD: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  // Backblaze B2 — media storage (optional, required for media uploads)
  B2_KEY_ID: z.string().optional(),
  B2_APP_KEY: z.string().optional(),
  B2_BUCKET_NAME: z.string().optional(),
  B2_BUCKET_REGION: z.string().default("us-west-004"),

  // Node environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    CRON_SECRET: process.env.CRON_SECRET,
    B2_KEY_ID: process.env.B2_KEY_ID,
    B2_APP_KEY: process.env.B2_APP_KEY,
    B2_BUCKET_NAME: process.env.B2_BUCKET_NAME,
    B2_BUCKET_REGION: process.env.B2_BUCKET_REGION,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  _env = parsed.data;
  return _env;
}
