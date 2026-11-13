import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Server Action that changes league data must stop while the operator
 * has the site read-only or paused (ADR 0009). The way to get that is to
 * check permission with `requirePermissionToChange` or `requireSelfToChange`;
 * the plain `requirePermission` and `requireSelf` are for pages that only
 * read. This test keeps new actions from slipping past.
 */

const ROOT = join(__dirname, "..", "..");

/** Actions that must keep working while frozen: signing in and out. */
const ALLOWED_WITHOUT_GUARD = new Set([
  "app/sign-in/actions.ts",
  "app/app/actions.ts",
  "app/demo/actions.ts",
  "app/operator/actions.ts",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const serverActionFiles = files(ROOT).filter((path) =>
  readFileSync(path, "utf8").trimStart().startsWith('"use server"'),
);

describe("Server Actions and the frozen site", () => {
  it("finds the Server Action files", () => {
    expect(serverActionFiles.length).toBeGreaterThan(10);
  });

  it.each(serverActionFiles.map((path) => [relative(ROOT, path), path]))(
    "%s checks permission with a guard that stops while frozen",
    (name, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\brequirePermission\(/);
      expect(source).not.toMatch(/\brequireSelf\(/);
      expect(source).not.toMatch(/\bcurrentSubject\(/);
      if (!ALLOWED_WITHOUT_GUARD.has(name))
        expect(source).toMatch(
          /\b(requirePermissionToChange|requireSelfToChange)\(/,
        );
    },
  );
});
