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
