import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import {
  inviteStateFor,
  MANY_ON_ONE_LIST,
  oversight,
  readEmail,
  readReason,
  REASON_MAX,
} from "./keep-off";

describe("the private reason", () => {
  it("is optional", () => {
    expect(readReason("")).toEqual(ok(null));
    expect(readReason("   ")).toEqual(ok(null));
    expect(readReason(null)).toEqual(ok(null));
  });

  it("is trimmed", () => {
    expect(readReason("  too rough on the bases ")).toEqual(
      ok("too rough on the bases"),
    );
  });

  it("has a length limit", () => {
    expect(readReason("x".repeat(REASON_MAX))).toEqual(
      ok("x".repeat(REASON_MAX)),
    );
    expect(readReason("x".repeat(REASON_MAX + 1))).toEqual(
      err("reason_too_long"),
    );
  });
});

describe("the email address typed in", () => {
  it("is trimmed and lower-cased", () => {
    expect(readEmail("  Sam.Example@Example.TEST ")).toBe(
      "sam.example@example.test",
    );
  });

  it("must look like an address", () => {
    for (const bad of ["", "sam", "sam@", "@example.test", "a b@c.d", 42])
      expect(readEmail(bad)).toBeNull();
  });
});

describe("an invite link opened by someone the team keeps off", () => {
  it("reads as expired, whatever its real state", () => {
    for (const state of ["open", "expired", "accepted", "revoked"] as const)
      expect(inviteStateFor(state, true)).toBe("expired");
  });

  it("is unchanged for everyone else", () => {
    for (const state of ["open", "expired", "accepted", "revoked"] as const)
      expect(inviteStateFor(state, false)).toBe(state);
  });
});

describe("oversight across every list", () => {
  const entry = (team: string, person: string) => ({
    teamId: `t-${team}`,
    teamName: team,
    userId: `u-${person}`,
    name: person,
  });

  it("counts each team's list, longest first", () => {
    const { teams } = oversight([
      entry("Aces", "Ari"),
      entry("Bees", "Bo"),
      entry("Bees", "Cy"),
    ]);
    expect(teams.map((t) => [t.teamName, t.count])).toEqual([
      ["Bees", 2],
      ["Aces", 1],
    ]);
  });

  it(`flags a team that lists ${MANY_ON_ONE_LIST} or more people`, () => {
    const many = Array.from({ length: MANY_ON_ONE_LIST }, (_, i) =>
      entry("Aces", `P${i}`),
    );
    expect(oversight(many).teams[0]?.many).toBe(true);
    expect(oversight(many.slice(1)).teams[0]?.many).toBe(false);
  });

  it("names people on more than one team's list", () => {
    const { people } = oversight([
      entry("Aces", "Ari"),
      entry("Bees", "Ari"),
      entry("Cats", "Ari"),
      entry("Bees", "Bo"),
    ]);
    expect(people).toEqual([
      { userId: "u-Ari", name: "Ari", teams: ["Aces", "Bees", "Cats"] },
    ]);
  });

  it("adds up to the number of entries, whatever their order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(fc.nat(4), fc.nat(9)), {
          selector: ([t, p]) => `${t}/${p}`,
        }),
        (pairs) => {
          const result = oversight(
            pairs.map(([t, p]) => entry(`T${t}`, `P${p}`)),
          );
          expect(result.teams.reduce((n, t) => n + t.count, 0)).toBe(
            pairs.length,
          );
          for (const p of result.people)
            expect(p.teams.length).toBeGreaterThan(1);
        },
      ),
    );
  });
});
