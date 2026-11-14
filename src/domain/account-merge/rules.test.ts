import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { user } from "@/db/schema/auth";
import {
  describeBlocker,
  fillProfile,
  mergedEmail,
  normalizeEmail,
  PERSON_COLUMNS,
  registrationToKeep,
  roleBlocks,
  signatureToKeep,
} from "./rules";

/** Drizzle's snake_case casing, as the migrations name columns. */
const snake = (name: string) =>
  name.replace(/[A-Z]/g, (c, i: number) => (i ? "_" : "") + c.toLowerCase());

/** Every `table.column` in the schema with a foreign key to `user.id`. */
function personColumns(): string[] {
  const found = new Set<string>();
  for (const table of Object.values(schema)) {
    if (!(table instanceof PgTable)) continue;
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (ref.foreignTable !== user) continue;
      for (const column of ref.columns)
        found.add(`${config.name}.${snake(column.name)}`);
    }
  }
  return [...found].sort();
}

describe("the merge rules", () => {
  it("cover every column that references a person, and nothing else", () => {
    const columns = personColumns();
    expect(columns.length).toBeGreaterThan(90);
    const missing = columns.filter((c) => !(c in PERSON_COLUMNS));
    const stale = Object.keys(PERSON_COLUMNS).filter(
      (c) => !columns.includes(c),
    );
    // A new table that points at a person needs a rule in rules.ts.
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("give every dedupe rule a key and every close rule its assignment", () => {
    for (const [column, rule] of Object.entries(PERSON_COLUMNS)) {
      if (rule.kind !== "dedupe") continue;
      expect(rule.by.length, column).toBeGreaterThan(0);
      if (rule.resolve === "close") expect(rule.close, column).toBeTruthy();
    }
  });
});

describe("conflict choices", () => {
  it("keeps the registration that has something on it", () => {
    expect(registrationToKeep({ empty: false }, { empty: true })).toBe("kept");
    expect(registrationToKeep({ empty: true }, { empty: false })).toBe(
      "merged",
    );
    expect(registrationToKeep({ empty: true }, { empty: true })).toBe("kept");
    expect(registrationToKeep({ empty: false }, { empty: false })).toBe(
      "blocked",
    );
  });

  it("keeps the earliest waiver signature", () => {
    const early = { signedAt: new Date("2027-01-01T00:00:00Z") };
    const late = { signedAt: new Date("2027-02-01T00:00:00Z") };
    expect(signatureToKeep(late, early)).toBe("merged");
    expect(signatureToKeep(early, late)).toBe("kept");
    expect(signatureToKeep(early, early)).toBe("kept");
  });

  it("refuses to merge away a higher role", () => {
    expect(roleBlocks("player", "admin")).toBe(true);
    expect(roleBlocks("admin", "owner")).toBe(true);
    expect(roleBlocks("owner", "admin")).toBe(false);
    expect(roleBlocks("player", "player")).toBe(false);
  });

  it("fills only the kept profile's empty fields", () => {
    expect(
      fillProfile(
        { phone: null, shirt: "m", birth: null },
        { phone: "+15555550101", shirt: "l", birth: null },
        ["phone", "shirt", "birth"],
      ),
    ).toEqual({ phone: "+15555550101" });
  });

  it("gives the merged-away account an address that cannot receive mail", () => {
    expect(mergedEmail("abc")).toBe("merged-abc@deleted.invalid");
    expect(normalizeEmail("  Pat@Example.TEST ")).toBe("pat@example.test");
  });

  it("explains every blocker", () => {
    for (const b of [
      { kind: "same_account" },
      { kind: "acting_admin" },
      { kind: "already_merged", which: "kept" },
      { kind: "already_merged", which: "merged" },
      { kind: "higher_role", role: "owner" },
      { kind: "both_registered", season: "Spring 2027" },
      { kind: "both_rebated", season: "Fall 2026" },
    ] as const)
      expect(describeBlocker(b).length).toBeGreaterThan(10);
  });
});
