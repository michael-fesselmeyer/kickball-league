import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forfeit, gamesArb, played, TEAMS } from "./games.fixture";
import { powerRankingsWithMovement } from "./power";
import {
  RECAP_BODY_MAX,
  RECAP_SUBJECT_MAX,
  type RecapInput,
  resultSentence,
  weeklyRecap,
} from "./recap";
import { leagueRecords } from "./records";
import { teamStreaks } from "./streaks";

const NAMES: Record<string, string> = {
  A: "Kickers",
  B: "Sluggers",
  C: "Pitch Slaps",
  D: "Base Invaders",
};
const name = (t: string) => NAMES[t] ?? `Team ${t}`;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function input(games = week, all = season): RecapInput {
  return {
    seasonName: "Spring 2027",
    dayLabel: "Sunday, April 11",
    games,
    name,
    power: powerRankingsWithMovement(["A", "B", "C", "D"], all, dayOf),
    streaks: teamStreaks(["A", "B", "C", "D"], all),
    records: [],
    nextUp: null,
    link: null,
  };
}

const earlier = [
  played("A", 3, "B", 5, 0),
  played("C", 6, "D", 2, 0),
  played("A", 4, "C", 6, 1),
  played("B", 2, "D", 1, 1),
];
const week = [played("A", 12, "D", 1, 7), played("B", 4, "C", 3, 7)];
const season = [...earlier, ...week];

describe("result sentences", () => {
  it("word each kind of result", () => {
    expect(resultSentence(played("A", 7, "B", 0), name)).toMatch(
      /Kickers (blanked|shut out) Sluggers 7–0/,
    );
    expect(resultSentence(played("A", 2, "B", 12), name)).toMatch(
      /Sluggers .*Kickers.*12–2/,
    );
    expect(resultSentence(played("A", 5, "B", 4), name)).toMatch(
      /Kickers (edged|held on to beat) Sluggers 5–4/,
    );
    expect(resultSentence(played("A", 6, "B", 3), name)).toMatch(
      /Kickers .*Sluggers.*6–3/,
    );
    expect(resultSentence(played("A", 3, "B", 3), name)).toMatch(
      /Kickers and Sluggers .*3–3/,
    );
    expect(resultSentence(forfeit("A", "B", "A"), name)).toBe(
      "Sluggers took the win by forfeit over Kickers.",
    );
    expect(resultSentence(forfeit("A", "B", "B"), name)).toBe(
      "Kickers took the win by forfeit over Sluggers.",
    );
  });

  it("pick the same words for the same game every time", () => {
    const g = played("A", 6, "B", 3);
    expect(resultSentence(g, name)).toBe(resultSentence(g, name));
  });
});

describe("weekly recap", () => {
  it("covers results, rankings, streaks and what's next", () => {
    const recap = weeklyRecap({
      ...input(),
      records: leagueRecords(season).filter((r) => r.key === "biggest_win"),
      nextUp: "Kickers vs Sluggers, Sunday at 2:00 PM.",
      link: "https://league.example.test/seasons/spring-2027/standings",
    });
    expect(recap.subject).toBe("Spring 2027 recap: Sunday, April 11");
    expect(recap.body).toContain("Here's how Sunday, April 11 went down.");
    expect(recap.body).toContain("12–1");
    expect(recap.body).toContain("Power rankings\n1. ");
    expect(recap.body).toContain("Biggest climber:");
    expect(recap.body).toContain(
      "Streak watch\nBase Invaders have lost 3 straight and are due.\nSluggers have won 3 straight.",
    );
    expect(recap.body).toContain(
      "New league records\n- Biggest win: Kickers, by 11 runs.",
    );
    expect(recap.body).toContain(
      "Game of the week\nKickers vs Sluggers, Sunday at 2:00 PM.",
    );
    expect(recap.body).toContain(
      "Full standings: https://league.example.test/seasons/spring-2027/standings",
    );
  });

  it("says so when the day has no scores yet", () => {
    const recap = weeklyRecap({ ...input([], []), power: [] });
    expect(recap.body).toBe(
      "No final scores from Sunday, April 11 yet.\n\nSee you on the field.",
    );
  });

  it("trims a subject that would be too long", () => {
    const recap = weeklyRecap({ ...input(), seasonName: "x".repeat(200) });
    expect(recap.subject).toHaveLength(RECAP_SUBJECT_MAX);
    expect(recap.subject.endsWith("…")).toBe(true);
  });

  it("stays within the announcement limits and never prints a blank", () => {
    fc.assert(
      fc.property(gamesArb(), fc.string({ maxLength: 300 }), (all, label) => {
        const recap = weeklyRecap({
          seasonName: "Spring 2027",
          dayLabel: label,
          games: all.slice(-12),
          name,
          power: powerRankingsWithMovement(TEAMS, all, dayOf),
          streaks: teamStreaks(TEAMS, all),
          records: leagueRecords(all),
          nextUp: null,
          link: null,
        });
        expect(recap.subject.length).toBeLessThanOrEqual(RECAP_SUBJECT_MAX);
        expect(recap.body.length).toBeLessThanOrEqual(RECAP_BODY_MAX);
        expect(recap.body).not.toMatch(/undefined|NaN|\[object/);
      }),
    );
  });
});
