import { describe, expect, it } from "vitest";
import { publicGame } from "@/domain/schedule/fixtures";
import { statGamesFrom } from "@/domain/stats/season";
import { recapInputFor } from "@/domain/stats/weekly";
import {
  checkRecapAnswer,
  RECAP_SYSTEM_PROMPT,
  type RecapFacts,
  recapFacts,
  recapPrompt,
} from "./recap";

const TZ = "America/New_York";
const LINK = "https://league.example.test/seasons/fall-2026/standings";
const cats = {
  id: "c",
  name: "Pitch Slaps",
  slug: "pitch-slaps",
  colorHex: null,
};
const dogs = {
  id: "d",
  name: "Base Invaders",
  slug: "base-invaders",
  colorHex: null,
};
const sluggers = {
  id: "b",
  name: "Sluggers",
  slug: "sluggers",
  colorHex: null,
};

const schedule = [
  // Monday, September 7.
  publicGame({
    id: "w1a",
    status: "final",
    scoreA: 6,
    scoreB: 2,
    startsAt: new Date("2026-09-07T23:00:00Z"),
  }),
  publicGame({
    id: "w1b",
    teamA: cats,
    teamB: dogs,
    status: "final",
    scoreA: 3,
    scoreB: 4,
    startsAt: new Date("2026-09-08T00:00:00Z"),
  }),
  // Monday, September 14.
  publicGame({
    id: "w2a",
    teamB: cats,
    status: "final",
    scoreA: 15,
    scoreB: 0,
    startsAt: new Date("2026-09-14T23:00:00Z"),
  }),
  publicGame({
    id: "w2b",
    teamA: sluggers,
    teamB: dogs,
    status: "forfeit",
    forfeitBy: "d",
    startsAt: new Date("2026-09-15T00:00:00Z"),
  }),
  publicGame({
    id: "w2c",
    teamA: cats,
    teamB: dogs,
    status: "final",
    scoreA: 5,
    scoreB: 5,
    startsAt: new Date("2026-09-15T01:00:00Z"),
  }),
  // Monday, September 21: still to play.
  publicGame({
    id: "w3a",
    teamB: dogs,
    startsAt: new Date("2026-09-21T23:00:00Z"),
  }),
];

const factsFor = (day: string, link: string | null = LINK) =>
  recapFacts(
    recapInputFor({
      seasonName: "Fall 2026",
      schedule,
      history: statGamesFrom(schedule),
      day,
      timeZone: TZ,
      link,
    }),
  );

describe("recapFacts", () => {
  it("gives the model the day's results with the winner first", () => {
    const facts = factsFor("2026-09-14");
    expect(facts.season).toBe("Fall 2026");
    expect(facts.gameDay).toBe("Monday, September 14");
    expect(facts.results).toEqual([
      {
        teams: ["Kickers", "Pitch Slaps"],
        outcome: "win",
        score: "15–0",
        margin: 15,
        shutout: true,
      },
      {
        teams: ["Sluggers", "Base Invaders"],
        outcome: "forfeit",
        score: null,
        margin: null,
        shutout: false,
      },
      {
        teams: ["Pitch Slaps", "Base Invaders"],
        outcome: "tie",
        score: "5–5",
        margin: 0,
        shutout: false,
      },
    ]);
  });

  it("ranks the teams with their records through the day", () => {
    const facts = factsFor("2026-09-14");
    const byTeam = Object.fromEntries(
      facts.rankings.map((r) => [r.team, r.record]),
    );
    expect(byTeam).toEqual({
      Kickers: "2–0",
      Sluggers: "1–1",
      "Base Invaders": "1–1–1",
      "Pitch Slaps": "0–2–1",
    });
    expect(facts.rankings.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(facts.rankings[0]).toMatchObject({ team: "Kickers" });
  });

  it("carries streaks, new records, next week and the link", () => {
    const facts = factsFor("2026-09-14");
    expect(facts.streaks).toContain("Kickers have won 2 straight.");
    expect(
      facts.newRecords.some((r) =>
        r.startsWith("Most runs in a game: Kickers"),
      ),
    ).toBe(true);
    expect(facts.gameOfTheWeek).toContain("Monday, September 21, 2026");
    expect(facts.standingsLink).toBe(LINK);
  });

  it("puts the facts in the prompt as data, apart from the instructions", () => {
    const facts = factsFor("2026-09-07", null);
    const prompt = recapPrompt(facts);
    expect(prompt).toContain("<facts>");
    expect(prompt).toContain('"score": "6–2"');
    expect(prompt).not.toContain("15–0");
    expect(RECAP_SYSTEM_PROMPT).toContain("Do not invent scores");
    expect(RECAP_SYSTEM_PROMPT).toContain("never suggest drinking is expected");
  });
});

describe("checkRecapAnswer", () => {
  const facts: RecapFacts = factsFor("2026-09-14");
  const good = {
    subject: "Week 2: Kickers go 2–0",
    body: `Kickers blanked Pitch Slaps 15-0. Pitch Slaps and Base Invaders split it 5 – 5, and Base Invaders sit at 1–1–1.\n\nStandings: ${LINK}.\nSee you Monday!`,
  };

  it("accepts a draft that quotes only real scores and records", () => {
    expect(checkRecapAnswer(good, facts)).toEqual({
      ok: true,
      value: good,
    });
  });

  it("accepts a score written loser first", () => {
    expect(
      checkRecapAnswer({ ...good, body: "Pitch Slaps fell 0–15." }, facts).ok,
    ).toBe(true);
  });

  it("trims what it accepts", () => {
    const result = checkRecapAnswer(
      { subject: "  Hi  ", body: "\nHello.\n" },
      facts,
    );
    expect(result).toEqual({
      ok: true,
      value: { subject: "Hi", body: "Hello." },
    });
  });

  it("refuses a score nobody played", () => {
    expect(
      checkRecapAnswer({ ...good, body: "Kickers won 14–2." }, facts),
    ).toEqual({
      ok: false,
      error: "unknown_score",
    });
    expect(
      checkRecapAnswer({ ...good, subject: "A 7-3 thriller" }, facts),
    ).toEqual({
      ok: false,
      error: "unknown_score",
    });
  });

  it("does not mistake a date or a long number for a score", () => {
    const body = "Next up on 2026-09-21. Over 1000 fans, give or take 999.";
    expect(checkRecapAnswer({ ...good, body }, facts).ok).toBe(true);
  });

  it("refuses any link but the standings page", () => {
    expect(
      checkRecapAnswer(
        { ...good, body: "Tickets at https://example.test/win" },
        facts,
      ),
    ).toEqual({ ok: false, error: "unknown_link" });
    expect(
      checkRecapAnswer({ ...good, body: `See ${LINK}/../admin` }, facts),
    ).toEqual({ ok: false, error: "unknown_link" });
  });

  it("refuses the wrong shape, blanks and drafts over the limits", () => {
    expect(checkRecapAnswer(null, facts)).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(checkRecapAnswer({ subject: "Hi" }, facts)).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(checkRecapAnswer({ subject: " ", body: "Hello" }, facts)).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(
      checkRecapAnswer({ subject: "x".repeat(121), body: "Hello" }, facts),
    ).toEqual({ ok: false, error: "too_long" });
    expect(
      checkRecapAnswer({ subject: "Hi", body: "x".repeat(5001) }, facts),
    ).toEqual({ ok: false, error: "too_long" });
  });
});
