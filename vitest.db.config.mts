import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Database integration tests: real Postgres, each test inside a transaction
 * that is rolled back. CI runs them in the Migrations job against a
 * throwaway database; locally they use DATABASE_URL from .env.local.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    setupFiles: ["src/db/test/load-env.ts"],
    fileParallelism: false,
  },
});
