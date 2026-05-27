import { defineConfig } from "vitest/config";
import path from "node:path";
import dotenv from "dotenv";

// Load .env before setup files run so real DB credentials are available.
dotenv.config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      include: ["src/lib/**/*.{ts,tsx}", "src/app/api/**/*.{ts,tsx}"],
      exclude: [
        "src/components/ui/**",
        "src/lib/db/db.ts",
        "src/types/**",
        "src/config/**",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
