import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { PERSON_COLUMNS } from "@/domain/account-merge/rules";
import * as schema from "./index";
import { user } from "./auth";

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
