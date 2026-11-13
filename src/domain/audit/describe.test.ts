import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeAction, describeChange, isOperatorAction } from "./describe";

describe("describeAction", () => {
  it("reads known actions in plain words and unknown ones as themselves", () => {
    expect(describeAction("schedule.publish")).toBe("Published the schedule");
    expect(describeAction("operator.site_status")).toBe(
      "Platform operator changed the site status",
    );
    expect(describeAction("something.new")).toBe("something.new");
  });

  it("has plain words for every action the app records", () => {
    const src = join(import.meta.dirname, "../..");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => readFileSync(join(src, f), "utf8"));
    const recorded = new Set(
      files.flatMap((text) =>
        [...text.matchAll(/action: "([a-z_]+\.[a-z_]+)"/g)].flatMap(
          (m) => m[1] ?? [],
        ),
      ),
    );
    expect(recorded.size).toBeGreaterThan(30);
    const missing = [...recorded].filter((a) => describeAction(a) === a);
    expect(missing).toEqual([]);
  });

  it("recognizes operator actions", () => {
    expect(isOperatorAction("operator.role")).toBe(true);
    expect(isOperatorAction("league.export")).toBe(false);
  });
});

describe("describeChange", () => {
  it("lists only the fields that changed", () => {
    expect(
      describeChange(
        { status: "active", name: "Fall" },
        { status: "paused", name: "Fall" },
      ),
    ).toEqual(["status: active → paused"]);
  });

  it("reads lists, missing values and nested records plainly", () => {
    expect(
      describeChange(
        { disabled: [], role: "player" },
        { disabled: ["subs", "weather"], role: undefined, extra: { a: 1 } },
      ),
    ).toEqual([
      "disabled: none → subs, weather",
      "role: player → none",
      "extra: none → (details)",
    ]);
  });

  it("makes no comparison without two records", () => {
    expect(describeChange(null, { a: 1 })).toEqual([]);
    expect(describeChange({ a: 1 }, "text")).toEqual([]);
  });
});
