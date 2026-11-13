import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIGEST_KIND,
  deliveryClassOf,
  MESSAGE_KINDS,
  NON_URGENT_KINDS,
  URGENT_LABELS,
} from "./kinds";

describe("deliveryClassOf", () => {
  it("follows the table", () => {
    expect(deliveryClassOf("rainout_notice")).toBe("urgent");
    expect(deliveryClassOf("announcement")).toBe("non_urgent");
    expect(deliveryClassOf(DIGEST_KIND)).toBe("digest");
  });

  it("treats a kind it does not know as urgent, so nothing is held by mistake", () => {
    expect(deliveryClassOf("not_a_kind")).toBe("urgent");
    expect(deliveryClassOf("toString")).toBe("urgent");
  });
});

describe("MESSAGE_KINDS", () => {
  it("lists the non-urgent kinds and the urgent labels from one table", () => {
    expect([...NON_URGENT_KINDS].sort()).toEqual([
      "announcement",
      "new_team",
      "score_reminder",
    ]);
    expect(URGENT_LABELS).toContain("Rain-outs and makeup times");
  });

  it("matches the table in docs/architecture.md, section 5", () => {
    const doc = readFileSync("docs/architecture.md", "utf8");
    const rows = [
      ...doc.matchAll(/^\| `([a-z_]+)` \| (urgent|non-urgent) \| (.+) \|$/gm),
    ].map(([, kind, urgency, label]) => [
      kind,
      urgency?.replace("-", "_"),
      label,
    ]);
    expect(rows).toEqual(
      Object.entries(MESSAGE_KINDS).map(([kind, k]) => [
        kind,
        k.urgency,
        k.label,
      ]),
    );
  });
});
