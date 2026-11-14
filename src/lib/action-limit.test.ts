import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const counted = vi.hoisted(() => ({ calls: [] as string[], allow: true }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/action-limits", () => ({
  withinActionLimit: async (_db: unknown, action: string, subject: string) => {
    counted.calls.push(`${action}:${subject}`);
    return counted.allow;
  },
}));

const { allowAction } = await import("./action-limit");

afterEach(() => {
  vi.unstubAllEnvs();
  counted.calls = [];
  counted.allow = true;
});

describe("allowAction", () => {
  it("counts the action against its limit", async () => {
    vi.stubEnv("DEMO_MODE", "");
    counted.allow = false;
    expect(await allowAction("checkout", "user-1")).toBe(false);
    expect(counted.calls).toEqual(["checkout:user-1"]);
  });

  it("lets the demo's shared personas through without counting", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://ci:ci@localhost:5432/kb_demo");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    counted.allow = false;
    expect(await allowAction("checkout", "user-1")).toBe(true);
    expect(counted.calls).toEqual([]);
  });
});

describe("Stripe Checkout sessions", () => {
  const root = join(__dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  const creating = files(root).filter((path) =>
    /checkout\.sessions\s*\.create\(/.test(readFileSync(path, "utf8")),
  );

  it("are found", () => {
    expect(creating.length).toBeGreaterThanOrEqual(4);
  });

  it.each(creating.map((path) => [relative(root, path), path]))(
    "%s limits how many a person starts",
    (_name, path) => {
      expect(readFileSync(path, "utf8")).toMatch(/allowAction\("checkout"/);
    },
  );
});
