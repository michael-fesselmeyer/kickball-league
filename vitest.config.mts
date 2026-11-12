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
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
