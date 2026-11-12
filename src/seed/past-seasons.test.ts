import { describe, expect, it } from "vitest";
import { allTimeRecords, seasonChampion } from "@/domain/history/history";
import { type ResultGame, standings } from "@/domain/standings/standings";
import { generateSeed } from "./generate";
import { generatePastSeasons, PAST_SEASONS } from "./past-seasons";

const data = generateSeed();
const past = generatePastSeasons(data);
const slugOf = new Map(
  [...data.teams, ...past.teams].map((t) => [t.id as string, t.slug]),
);

/** Each past season's standings, keyed by team slug. */
const results = past.seasons.map(({ season, entries, games }) => {
  const entrySlug = new Map(
    entries.map((e) => [e.id as string, slugOf.get(e.teamId) as string]),
  );
  const slug = (id: string) => entrySlug.get(id) as string;
  const finished = games.map((g): ResultGame =>
    g.status === "forfeit"
      ? {
          kind: "forfeit",
          teamA: slug(g.teamAId),
          teamB: slug(g.teamBId),
          forfeitBy: slug(g.forfeitBy as string),
        }
      : {
          kind: "played",
          teamA: slug(g.teamAId),
          teamB: slug(g.teamBId),
          scoreA: g.scoreA as number,
          scoreB: g.scoreB as number,
        },
  );
  return {
    seasonId: season.id,
    completed: true,
    rows: standings([...entrySlug.values()], finished, { seed: season.id }),
  };
});

describe("generatePastSeasons", () => {
  it("is deterministic", () => {
    expect(generatePastSeasons(generateSeed())).toEqual(past);
  });

  it("gives every row its own id, apart from the generated league's", () => {
    const ids = [
      ...past.teams.map((t) => t.id),
      ...past.seasons.flatMap((s) => [
        s.season.id,
        ...s.entries.map((e) => e.id),
        ...s.slots.map((x) => x.id),
        ...s.games.map((g) => g.id as string),
      ]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const generated = new Set<string>([
      ...data.teams.map((t) => t.id),
      ...data.games.map((g) => g.id),
      ...data.slots.map((s) => s.id),
    ]);
    expect(ids.some((id) => generated.has(id))).toBe(false);
  });

  it("plays a full, finished round robin in every completed season", () => {
    for (const [i, s] of past.seasons.entries()) {
      const teams = s.entries.length;
      expect(s.season.status).toBe("completed");
      expect(s.games).toHaveLength((teams * (teams - 1)) / 2);
      expect(
        s.games.every((g) => g.status === "final" || g.status === "forfeit"),
      ).toBe(true);
      expect(s.season.endsOn < data.season.startsOn).toBe(true);
      expect(s.season.slug).toBe(PAST_SEASONS[i]?.slug);
    }
  });

  it("crowns a two-time champion and a newcomer", () => {
    const champions = results.map(seasonChampion);
    expect(champions).toEqual(["sun-kickers", "sun-kickers", "foul-play"]);
    const [first] = allTimeRecords(results);
    expect(first).toMatchObject({ team: "sun-kickers", titles: 2 });
  });

  it("includes a forfeit and the retired teams", () => {
    expect(
      past.seasons.flatMap((s) => s.games).some((g) => g.status === "forfeit"),
    ).toBe(true);
    expect(past.teams.map((t) => t.slug)).toEqual([
      "kick-starters",
      "rubber-duckies",
    ]);
  });
});
