import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs the real reset script. Its database address points at a closed port,
 * so if the guard ever let it through it would fail differently (and could
 * not touch any data).
 */
function runReset(env: Record<string, string>) {
  const root = process.cwd();
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/tsx/dist/cli.mjs"),
      join(root, "scripts/reset-demo.ts"),
    ],
    {
      cwd: root,
      // Only what is given: nothing from this shell or .env.local leaks in.
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  return { code: result.status, stderr: result.stderr, stdout: result.stdout };
}

const unreachable = "postgresql://ci:ci@127.0.0.1:1";

describe("npm run demo:reset", () => {
  it("refuses with demo mode off", () => {
    const run = runReset({ DATABASE_URL: `${unreachable}/kickball_demo` });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/Refusing to reset: demo mode is off/);
    expect(run.stdout).not.toMatch(/Resetting/);
  });

  it("refuses a database that is not a demo's, even with DEMO_MODE=true", () => {
    const run = runReset({
      DEMO_MODE: "true",
      DATABASE_URL: `${unreachable}/kickball`,
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/not a demo database/);
  });

  it("refuses the league's production deployment", () => {
    const run = runReset({
      DEMO_MODE: "true",
      DATABASE_URL: `${unreachable}/kickball_demo`,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "kickball-league.vercel.app",
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/production deployment/);
  });
});
