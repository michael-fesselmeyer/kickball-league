import { describe, expect, it } from "vitest";
import { PUBLIC_CATEGORIES, parseConcern } from "./concerns";

const PUBLIC = Object.keys(PUBLIC_CATEGORIES);
const base = {
  category: "field_problem",
  parkRule: "",
  body: "  Someone left glass by the backstop.  ",
  occurredOn: "",
  place: "",
  replyEmail: "",
};
const parse = (over: Partial<typeof base> = {}) =>
  parseConcern({ ...base, ...over }, PUBLIC, "2026-11-15");

describe("parseConcern", () => {
  it("trims, and treats the optional fields as absent", () => {
    expect(parse()).toEqual({
      ok: true,
      value: {
        category: "field_problem",
        parkRule: null,
        body: "Someone left glass by the backstop.",
        occurredOn: null,
        place: null,
        replyEmail: null,
      },
    });
  });

  it("keeps a park rule only for the park category", () => {
    const other = parse({ parkRule: "litter" });
    expect(other.ok && other.value.parkRule).toBeNull();
    const park = parse({ category: "park_rules", parkRule: "litter" });
    expect(park.ok && park.value.parkRule).toBe("litter");
    expect(parse({ category: "park_rules", parkRule: "nope" })).toEqual({
      ok: false,
      error: "park_rule",
    });
  });

  it("refuses a category the form doesn't offer, such as a player-only one", () => {
    expect(parse({ category: "treatment" })).toEqual({
      ok: false,
      error: "category",
    });
    expect(parse({ category: "constructor" })).toEqual({
      ok: false,
      error: "category",
    });
  });

  it("checks the message, date, place and address", () => {
    expect(parse({ body: "   " })).toEqual({ ok: false, error: "body" });
    expect(parse({ body: "x".repeat(2001) })).toEqual({
      ok: false,
      error: "body",
    });
    expect(parse({ occurredOn: "2026-11-16" })).toEqual({
      ok: false,
      error: "date",
    });
    expect(parse({ occurredOn: "2026-13-40" })).toEqual({
      ok: false,
      error: "date",
    });
    expect(parse({ place: "x".repeat(81) })).toEqual({
      ok: false,
      error: "place",
    });
    expect(parse({ replyEmail: "not an address" })).toEqual({
      ok: false,
      error: "email",
    });
    const ok = parse({ replyEmail: " Pat@Example.TEST " });
    expect(ok.ok && ok.value.replyEmail).toBe("pat@example.test");
  });
});
