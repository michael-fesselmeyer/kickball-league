import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { permitOfficeFor } from "./office";

/**
 * A group's contact is admin-only (issue #408). It lives in field_group, so
 * the places that may read that table are the admin screens, which need
 * `season.manage`, and the query layer under them. A public page, a player
 * screen, an export or a job reading it would leak the contact.
 */
const SRC = join(process.cwd(), "src");
const READERS = /db\/(queries|schema)\/field-groups["']/;
const ALLOWED = [
  /^db\//,
  /^app\/app\/admin\//,
  // The domain module imports nothing from the database.
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

describe("the group contact stays admin-only", () => {
  it("is read only by admin screens and the query layer", () => {
    const readers = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .filter((f) => READERS.test(readFileSync(join(SRC, f), "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    const outside = readers.filter((f) => !ALLOWED.some((a) => a.test(f)));
    expect(outside).toEqual([]);
  });

  it("is never selected by a query outside the group queries", () => {
    const leaks = files(join(SRC, "db", "queries"))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith("field-groups.ts"))
      .filter((f) => /fieldGroup\.contact/.test(readFileSync(f, "utf8")));
    expect(leaks).toEqual([]);
  });

  it("is never read by the admin pages outside the fields and game-day screens", () => {
    const admin = files(join(SRC, "app", "app", "admin"))
      .map((f) => relative(SRC, f))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .filter((f) => READERS.test(readFileSync(join(SRC, f), "utf8")));
    expect(admin.every((f) => /\/(fields|today)\//.test(f))).toBe(true);
  });
});

describe("permitOfficeFor", () => {
  it("gives a Brooklyn venue the Brooklyn permit office's number", () => {
    const office = permitOfficeFor({ lat: 40.7218, lng: -73.9516 }, "Field 1");
    expect(office.name).toBe("Brooklyn permit office");
    expect(office.phone).toBe("(718) 965-8975");
  });

  it("gives a Manhattan venue the Manhattan office's number", () => {
    const office = permitOfficeFor({ lat: 40.7829, lng: -73.9654 }, "Field 1");
    expect(office.phone).toBe("(212) 408-0234");
  });

  it("points a venue Parks' data doesn't place at the list of offices", () => {
    const office = permitOfficeFor(null, "Field 1");
    expect(office.phone).toBeNull();
    expect(office.page).toMatch(/^https:\/\/www\.nycgovparks\.org\//);
  });
});
