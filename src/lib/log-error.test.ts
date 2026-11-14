import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loggedError, logError } from "./log-error";

afterEach(() => vi.restoreAllMocks());

/** A Postgres driver error, as pg throws it. */
const pgError = (message: string, code: string) =>
  Object.assign(new Error(message), {
    code,
    detail: "Key (email)=(player@example.test) already exists.",
  });

describe("loggedError", () => {
  it("keeps a failed query's cause, never its parameters", () => {
    const failed = new DrizzleQueryError(
      'insert into "user" ("email") values ($1)',
      ["player@example.test"],
      pgError(
        'duplicate key value violates unique constraint "user_email"',
        "23505",
      ),
    );
    const logged = loggedError(failed);
    expect(logged).toEqual({
      code: "23505",
      message: 'duplicate key value violates unique constraint "user_email"',
    });
    expect(JSON.stringify(logged)).not.toContain("example.test");
  });

  it("takes one line, and hides any address in it", () => {
    expect(
      loggedError(new Error("Could not send to player@example.test\nmore")),
    ).toEqual({ code: null, message: "Could not send to [address]" });
  });

  it("reads Stripe's code and anything thrown that isn't an Error", () => {
    expect(
      loggedError(
        Object.assign(new Error("Your card was declined."), {
          code: "card_declined",
        }),
      ),
    ).toEqual({ code: "card_declined", message: "Your card was declined." });
    expect(loggedError("timeout")).toEqual({ code: null, message: "timeout" });
    expect(loggedError({ nope: true })).toEqual({
      code: null,
      message: "Unknown error",
    });
  });
});

describe("logError", () => {
  it("logs the context, ids and the reduced error only", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError(
      "Stripe refund failed",
      new DrizzleQueryError("select 1", ["player@example.test"]),
      "refund-1",
    );
    expect(spy).toHaveBeenCalledWith("Stripe refund failed", "refund-1", {
      code: null,
      message: "Failed query",
    });
  });
});

describe("errors in the server's logs", () => {
  it("go through logError, so no error object is logged whole", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const root = join(__dirname, "..");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
      });
    const raw = files(root)
      .filter((path) => !path.endsWith("log-error.ts"))
      .filter((path) => /console\.error\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(raw).toEqual([]);
  });
});
