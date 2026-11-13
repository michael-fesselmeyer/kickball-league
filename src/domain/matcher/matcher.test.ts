import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkFielding } from "../rsvp/fielding";
import {
  fieldingGain,
  fieldingShortfall,
  sideNeed,
  suggestNewTeam,
  suggestPlacements,
  type MatchTeam,
  type Player,
  type PoolPlayer,
} from "./matcher";
import { AVAILABILITY, POSITIONS } from "./quiz";

const player = (over: Partial<Player> = {}): Player => ({
  side: "woman",
  skill: 3,
  vibe: 3,
  availability: "every_week",
  positions: [],
  groupId: null,
  ...over,
});

let next = 0;
const free = (name: string, over: Partial<PoolPlayer> = {}): PoolPlayer => ({
  ...player(),
  registrationId: `r-${name}`,
  name,
  captain: "no",
  order: next++,
  ...over,
});

const team = (name: string, members: Player[], capacity = 14): MatchTeam => ({
  teamSeasonId: `t-${name}`,
  name,
  capacity,
  members,
});

const many = (n: number, over: Partial<Player> = {}) =>
  Array.from({ length: n }, () => player(over));

describe("suggestPlacements", () => {
  it("sends a woman to the team short on women, and says why", () => {
    const result = suggestPlacements(
      [free("Ana", { side: "woman" })],
      [
        team("Lightning", [
          ...many(6, { side: "woman" }),
          ...many(6, { side: "man" }),
        ]),
        team("Thunder", [
          ...many(3, { side: "woman" }),
          ...many(7, { side: "man" }),
        ]),
      ],
    );
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        teamName: "Thunder",
        registrationIds: ["r-Ana"],
      }),
    ]);
    expect(result.suggestions[0]?.reasons[0]).toBe(
      "Helps Thunder field a full lineup: it has 3 women and 7 men.",
    );
  });

  it("matches vibe when fielding is even", () => {
    const result = suggestPlacements(
      [free("Bo", { side: null, vibe: 5 })],
      [
        team("Chill", many(8, { vibe: 1 })),
        team("Sharks", many(8, { vibe: 5 })),
      ],
    );
    expect(result.suggestions[0]?.teamName).toBe("Sharks");
    expect(result.suggestions[0]?.reasons).toContain(
      "Same vibe: Sharks is here to win.",
    );
  });

  it("describes experience from the team's side", () => {
    const newer = team("Rookies", many(6, { side: null, skill: 1 }));
    const veterans = team("Vets", many(6, { side: null, skill: 5 }));
    const keen = suggestPlacements(
      [free("Ace", { side: null, skill: 5, vibe: null })],
      [newer, veterans],
    );
    expect(keen.suggestions[0]?.reasons).toContain(
      "Brings experience to Rookies, a newer team.",
    );
    const fresh = suggestPlacements(
      [free("Newt", { side: null, skill: 1, vibe: null })],
      [newer, veterans],
    );
    expect(fresh.suggestions[0]?.reasons).toContain(
      "Joins Vets, an experienced team that can show them the ropes.",
    );
  });

  it("fills a missing pitcher", () => {
    const result = suggestPlacements(
      [free("Cy", { side: null, positions: ["pitcher"] })],
      [
        team("A", many(8, { positions: ["pitcher"] })),
        team("B", many(8, { positions: ["outfield"] })),
      ],
    );
    expect(result.suggestions[0]?.teamName).toBe("B");
    expect(result.suggestions[0]?.reasons).toContain(
      "Wants to pitch, and nobody on B has said they do.",
    );
  });

  it("keeps a friend group together and names them", () => {
    const result = suggestPlacements(
      [
        free("Dee", { groupId: "g1", side: "woman" }),
        free("Eli", { groupId: "g1", side: "man" }),
        free("Fay", { side: "man" }),
      ],
      [
        team("A", many(4, { side: "man" })),
        team("B", many(4, { side: "woman" })),
      ],
    );
    const group = result.suggestions.find((s) => s.names.includes("Dee"));
    expect(group?.registrationIds).toEqual(["r-Dee", "r-Eli"]);
    expect(group?.reasons[0]).toBe("Keeps Dee and Eli together.");
  });

  it("sends a friend to the team their group already plays on", () => {
    const result = suggestPlacements(
      [free("Gus", { groupId: "g2", side: "man" })],
      [
        team("A", [...many(3, { side: "man" }), player({ groupId: "g2" })]),
        team("B", many(2, { side: "woman" })),
      ],
    );
    expect(result.suggestions[0]?.teamName).toBe("A");
    expect(result.suggestions[0]?.reasons[0]).toBe(
      "Joins their friend group on A.",
    );
  });

  it("leaves a group out rather than splitting it", () => {
    const result = suggestPlacements(
      [
        free("Hal", { groupId: "g3" }),
        free("Ivy", { groupId: "g3" }),
        free("Jo", { groupId: "g3" }),
      ],
      [team("A", many(12), 14), team("B", many(13), 14)],
    );
    expect(result.suggestions).toEqual([]);
    expect(result.unplaced[0]?.reason).toBe(
      "No team has room for Hal, Ivy and Jo together.",
    );
  });

  it("never suggests a team that keeps the player off", () => {
    const short = team("Short", many(3, { side: "man" }));
    const result = suggestPlacements(
      [free("Kit", { side: "woman" })],
      [
        { ...short, keepOff: ["r-Kit"] },
        team("Even", [...many(6, { side: "woman" }), ...many(6)]),
      ],
    );
    expect(result.suggestions.map((s) => s.teamName)).toEqual(["Even"]);
  });

  it("leaves a player out when every team with room keeps them off", () => {
    const result = suggestPlacements(
      [free("Lou")],
      [{ ...team("Only", many(2)), keepOff: ["r-Lou"] }],
    );
    expect(result.suggestions).toEqual([]);
    expect(result.unplaced[0]?.reason).toBe(
      "Every team with room has them on its list.",
    );
  });

  it("keeps a friend group off a team that lists one of them", () => {
    const result = suggestPlacements(
      [free("Mo", { groupId: "g9" }), free("Ned", { groupId: "g9" })],
      [{ ...team("A", many(4)), keepOff: ["r-Ned"] }, team("B", many(10))],
    );
    expect(result.suggestions[0]?.teamName).toBe("B");
    expect(result.suggestions[0]?.names).toEqual(["Mo", "Ned"]);
  });

  it("does not send a friend to their group's team when it lists them", () => {
    const result = suggestPlacements(
      [free("Oz", { groupId: "g8" })],
      [
        { ...team("A", [player({ groupId: "g8" })]), keepOff: ["r-Oz"] },
        team("B", many(2)),
      ],
    );
    expect(result.suggestions).toEqual([]);
    expect(result.unplaced[0]?.reason).toBe(
      "Their friend group is on A, whose captain has them on the team's list.",
    );
  });

  it("reports before and after counts for each team", () => {
    const result = suggestPlacements(
      [free("Kim", { side: "woman" })],
      [team("A", many(2, { side: "man" }))],
    );
    expect(result.teams[0]).toMatchObject({
      before: { players: 2, women: 0, men: 2 },
      after: { players: 3, women: 1, men: 2 },
    });
  });
});

// Arbitrary pools and teams for the property tests.
const side = fc.constantFrom<Player["side"]>("woman", "man", null);
const arbPlayer = (groups: number): fc.Arbitrary<Player> =>
  fc.record({
    side,
    skill: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
    vibe: fc.option(fc.constantFrom(1, 3, 5), { nil: null }),
    availability: fc.option(fc.constantFrom(...AVAILABILITY), { nil: null }),
    positions: fc.subarray([...POSITIONS]),
    groupId: fc.option(
      fc.integer({ min: 0, max: groups }).map((g) => `g${g}`),
      { nil: null, freq: 2 },
    ),
  });

const world = fc
  .record({
    teams: fc.array(
      fc.record({
        capacity: fc.integer({ min: 1, max: 16 }),
        members: fc.array(arbPlayer(3), { maxLength: 16 }),
      }),
      { maxLength: 6 },
    ),
    pool: fc.array(arbPlayer(8), { maxLength: 30 }),
  })
  .map(({ teams, pool }) => {
    // A group on a team lives on one team only, as in the database.
    const owner = new Map<string, number>();
    const matchTeams = teams.map((t, i) => ({
      teamSeasonId: `t${i}`,
      name: `Team ${i}`,
      capacity: t.capacity,
      members: t.members.map((m) => {
        if (m.groupId === null) return m;
        const seen = owner.get(m.groupId);
        if (seen === undefined) owner.set(m.groupId, i);
        return seen === undefined || seen === i ? m : { ...m, groupId: null };
      }),
    }));
    const poolPlayers = pool.map((p, i) => ({
      ...p,
      registrationId: `r${i}`,
      name: `P${i}`,
      captain: null,
      order: i,
    }));
    return { teams: matchTeams, pool: poolPlayers };
  });

describe("suggestPlacements properties", () => {
  it("places each pool player at most once, and only pool players", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        const { suggestions, unplaced } = suggestPlacements(pool, teams);
        const ids = [
          ...suggestions.flatMap((s) => s.registrationIds),
          ...unplaced.flatMap((u) => u.registrationIds),
        ];
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.sort()).toEqual(pool.map((p) => p.registrationId).sort());
      }),
    );
  });

  it("keeps friend groups together", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        const { suggestions } = suggestPlacements(pool, teams);
        const teamOf = new Map<string, string>();
        for (const s of suggestions)
          for (const id of s.registrationIds) teamOf.set(id, s.teamSeasonId);
        const byGroup = new Map<string, Set<string | undefined>>();
        for (const p of pool) {
          if (!p.groupId) continue;
          const set = byGroup.get(p.groupId) ?? new Set();
          set.add(teamOf.get(p.registrationId));
          byGroup.set(p.groupId, set);
        }
        for (const [groupId, placed] of byGroup) {
          // Everyone in the group lands together, or nobody is placed.
          expect(placed.size).toBe(1);
          const home = teams.find((t) =>
            t.members.some((m) => m.groupId === groupId),
          );
          const [where] = [...placed];
          if (home && where !== undefined)
            expect(where).toBe(home.teamSeasonId);
        }
      }),
    );
  });

  it("never places anyone on a team whose list keeps them off", () => {
    fc.assert(
      fc.property(
        world,
        fc.array(fc.tuple(fc.nat(5), fc.nat(29)), { maxLength: 40 }),
        ({ teams, pool }, pairs) => {
          const listed = teams.map((t, i) => ({
            ...t,
            keepOff: pairs.filter(([ti]) => ti === i).map(([, r]) => `r${r}`),
          }));
          for (const s of suggestPlacements(pool, listed).suggestions) {
            const t = listed.find((x) => x.teamSeasonId === s.teamSeasonId);
            for (const id of s.registrationIds)
              expect(t?.keepOff).not.toContain(id);
          }
        },
      ),
    );
  });

  it("keeps every team within its capacity", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        const result = suggestPlacements(pool, teams);
        for (const t of teams) {
          const added = result.suggestions
            .filter((s) => s.teamSeasonId === t.teamSeasonId)
            .reduce((n, s) => n + s.registrationIds.length, 0);
          if (added > 0)
            expect(t.members.length + added).toBeLessThanOrEqual(t.capacity);
          const outlook = result.teams.find(
            (o) => o.teamSeasonId === t.teamSeasonId,
          );
          expect(outlook?.after.players).toBe(t.members.length + added);
        }
      }),
    );
  });

  it("improves or holds every team's fielding balance", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        for (const t of suggestPlacements(pool, teams).teams) {
          const need = sideNeed(t.capacity);
          expect(fieldingShortfall({ ...t.after, need })).toBeLessThanOrEqual(
            fieldingShortfall({ ...t.before, need }),
          );
          const before = checkFielding(t.before);
          const after = checkFielding(t.after);
          expect(after.fielders).toBeGreaterThanOrEqual(before.fielders);
        }
      }),
    );
  });

  it("spreads players over empty teams instead of piling onto one", () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      free(`S${i}`, { side: i % 2 ? "man" : "woman" }),
    );
    const teams = ["A", "B", "C", "D"].map((n) => team(n, []));
    const sizes = suggestPlacements(pool, teams).teams.map(
      (t) => t.after.players,
    );
    expect(sizes).toEqual([2, 2, 2, 2]);
  });

  it("puts each single player where they cut a team's fielding shortfall the most", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        const { suggestions } = suggestPlacements(pool, teams);
        // Replay the suggestions in order and check each choice against the
        // teams as they stood at that moment.
        const state = new Map(
          teams.map((t) => [
            t.teamSeasonId,
            {
              capacity: t.capacity,
              need: sideNeed(t.capacity),
              players: t.members.length,
              women: t.members.filter((m) => m.side === "woman").length,
              men: t.members.filter((m) => m.side === "man").length,
              groups: new Set(t.members.flatMap((m) => m.groupId ?? [])),
            },
          ]),
        );
        const byId = new Map(pool.map((p) => [p.registrationId, p]));
        for (const s of suggestions) {
          const players = s.registrationIds.map((id) => byId.get(id)!);
          const chosen = state.get(s.teamSeasonId)!;
          const single = players.length === 1 ? players[0]! : null;
          const anchored =
            single?.groupId != null && chosen.groups.has(single.groupId);
          if (single && single.side && !anchored) {
            const gains = [...state.values()]
              .filter((t) => t.capacity - t.players >= 1)
              .map((t) => fieldingGain(t, [single]));
            expect(fieldingGain(chosen, [single])).toBe(Math.max(...gains));
          }
          chosen.players += players.length;
          chosen.women += players.filter((p) => p.side === "woman").length;
          chosen.men += players.filter((p) => p.side === "man").length;
          for (const p of players) if (p.groupId) chosen.groups.add(p.groupId);
        }
      }),
    );
  });

  it("gives every suggestion one to three reasons", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        const { suggestions, unplaced } = suggestPlacements(pool, teams);
        for (const s of suggestions) {
          expect(s.reasons.length).toBeGreaterThanOrEqual(1);
          expect(s.reasons.length).toBeLessThanOrEqual(3);
        }
        for (const u of unplaced) expect(u.reason).not.toBe("");
      }),
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(world, ({ teams, pool }) => {
        expect(suggestPlacements(pool, teams)).toEqual(
          suggestPlacements([...pool].reverse(), teams),
        );
      }),
    );
  });
});

describe("suggestNewTeam", () => {
  it("picks the volunteer captain and balances the roster", () => {
    const pool = [
      free("Al", { side: "man" }),
      free("Bea", { side: "woman", captain: "yes", skill: 4 }),
      free("Cal", { side: "man" }),
      free("Dot", { side: "woman" }),
      free("Ed", { side: "man" }),
    ];
    const suggestion = suggestNewTeam(pool, 4);
    expect(suggestion.captainId).toBe("r-Bea");
    expect(suggestion.registrationIds).toHaveLength(4);
    expect(suggestion.registrationIds).toContain("r-Dot");
    expect(suggestion.reasons).toEqual([
      "Bea offered to captain.",
      "4 players: 2 women and 2 men.",
    ]);
  });

  it("says when nobody volunteered to captain", () => {
    expect(suggestNewTeam([free("Flo")], 10)).toMatchObject({
      captainId: null,
      reasons: [
        "Nobody in the pool offered to captain yet.",
        "1 player: 1 woman and 0 men.",
      ],
    });
  });

  it("keeps groups together, stays within size, and stays even while both sides last", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlayer(4), { maxLength: 30 }),
        fc.integer({ min: 1, max: 16 }),
        (players, size) => {
          const pool = players.map((p, i) => ({
            ...p,
            registrationId: `r${i}`,
            name: `P${i}`,
            captain: i % 5 === 0 ? ("yes" as const) : ("no" as const),
            order: i,
          }));
          const { registrationIds, captainId } = suggestNewTeam(pool, size);
          expect(registrationIds.length).toBeLessThanOrEqual(size);
          if (captainId) expect(registrationIds).toContain(captainId);
          const chosen = new Set(registrationIds);
          const groups = new Map<string, boolean[]>();
          for (const p of pool)
            if (p.groupId)
              groups.set(p.groupId, [
                ...(groups.get(p.groupId) ?? []),
                chosen.has(p.registrationId),
              ]);
          for (const flags of groups.values())
            expect(new Set(flags).size).toBe(1);

          // With single players of known sides only, the roster is even
          // to within one, unless one side ran out.
          const singles = pool.filter((p) => !p.groupId && p.side);
          if (singles.length !== pool.length) return;
          const picked = singles.filter((p) => chosen.has(p.registrationId));
          const women = picked.filter((p) => p.side === "woman").length;
          const men = picked.length - women;
          const poolWomen = singles.filter((p) => p.side === "woman").length;
          const poolMen = singles.length - poolWomen;
          if (women < poolWomen && men < poolMen)
            expect(Math.abs(women - men)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
