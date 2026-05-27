// src/lib/db/db.ts
// Prisma client singleton with pg adapter.
// Prisma 7 requires an adapter — new PrismaClient() without args throws.
// Uses @prisma/adapter-pg with pg Pool for reliable Neon connections.
//
// Uses DATABASE_URL (POOLED, via PgBouncer) for runtime queries.
// PgBouncer multiplexes thousands of client connections onto a small
// pool of database connections on the Neon side — perfect for serverless.
// Each Vercel function invocation is a separate process, so max:1 is correct;
// PgBouncer handles connection pooling on the server side.
// DATABASE_URL_UNPOOLED is used only for Prisma CLI (migrations, db push)
// which is configured in prisma.config.ts.
//
// SAFETY: If DATABASE_URL is a stale SQLite file:// path (leftover from
// a previous dev environment), we fall back to DATABASE_URL_UNPOOLED.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: pg.Pool | undefined;
};

function createPrismaClient(): PrismaClient {
  // Use POOLED URL for runtime — PgBouncer manages server-side connection pooling.
  // Each Vercel function invocation is a separate process, so max:1 is correct here.
  // PgBouncer multiplexes thousands of client connections onto a small pool of
  // database connections on the Neon side.
  let connectionString = process.env.DATABASE_URL;

  // Safety: if DATABASE_URL is a stale SQLite file:// path, fall back to UNPOOLED
  if (!connectionString || connectionString.startsWith("file:")) {
    connectionString = process.env.DATABASE_URL_UNPOOLED;
  }

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Set it to your Neon pooled connection string."
    );
  }

  const pool =
    globalForPrisma.pool ??
    new pg.Pool({
      connectionString,
      ssl: true,
      max: 1, // PgBouncer handles pooling server-side
      idleTimeoutMillis: 5_000, // Short — PgBouncer keeps the server-side pool warm
      connectionTimeoutMillis: 10_000,
    });

  pool.on("error", (err: Error) => {
    process.stderr.write(`[db] Unexpected pool error: ${err.message}\n`);
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pool = pool;
  }

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
