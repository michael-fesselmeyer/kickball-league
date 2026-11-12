import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Domain tests are plain TypeScript. Component tests opt in to a DOM
    // with a `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Database tests need Postgres and run on their own: npm run test:db
    exclude: ["src/**/*.db.test.ts", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/lib/**"],
      exclude: ["**/*.bench.ts", "**/__snapshots__/**"],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        // The scheduler is the module the most depends on
        // (docs/scheduling-algorithm.md, section 11).
        "src/domain/scheduler/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  },
});
