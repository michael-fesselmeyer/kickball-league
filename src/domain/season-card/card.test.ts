import { describe, expect, it } from "vitest";
import {
  attendanceText,
  awardsWon,
  bestGame,
  biggestInning,
  buildCard,
  CARD_VERSION,
  closeWins,
  finishText,
  gameLine,
  highlights,
  isCurrentCard,
  longestWinStreak,
  playerGames,
  recordOf,
  recordText,
  sportsmanshipShout,
  superlatives,
  type TeamGame,
} from "./card";

let n = 0;
/** A team game; W/L/T from the score unless it is a forfeit. */
function g(
  day: string,
  runsFor: number | null,
  runsAgainst: number | null,
  opponent = "Sun Kickers",
  forfeit?: "W" | "L",
): TeamGame {
  n++;
  const outcome =
    forfeit ??
    ((runsFor ?? 0) > (runsAgainst ?? 0)
      ? "W"
      : (runsFor ?? 0) < (runsAgainst ?? 0)
        ? "L"
        : "T");
  return {
    gameId: `g${n}`,
    day,
    opponent,
    playoff: false,
    runsFor,
    runsAgainst,
    outcome,
  };
}

const everyGame = { attended: new Set<string>(), tracked: false };
const at = (...games: TeamGame[]) => ({
  attended: new Set(games.map((x) => x.gameId)),
  tracked: true,
});

describe("playerGames", () => {
  it("counts every team game when attendance was not tracked", () => {
    const games = [g("2026-06-01", 5, 3), g("2026-06-08", 1, 4)];
    expect(playerGames(games, everyGame)).toHaveLength(2);
  });

  it("counts only the games the player was at when it was", () => {
    const [a, b] = [g("2026-06-01", 5, 3), g("2026-06-08", 1, 4)];
    expect(playerGames([a, b], at(b))).toEqual([b]);
    expect(playerGames([a, b], at())).toEqual([]);
  });
});

describe("longestWinStreak", () => {
  it("is the longest run of wins in date order", () => {
    const games = [
      g("2026-06-22", 4, 2),
      g("2026-06-01", 5, 3),
      g("2026-06-08", 6, 1),
      g("2026-06-15", 1, 4),
      g("2026-06-29", 3, 2),
      g("2026-07-06", 9, 0),
    ];
    // W W L W W W by date.
    expect(longestWinStreak(games, everyGame)).toBe(3);
  });

  it("skips games the player missed instead of ending the run", () => {
    const [a, b, c] = [
      g("2026-06-01", 5, 3),
      g("2026-06-08", 0, 7),
      g("2026-06-15", 4, 2),
    ];
    // The loss was a game they missed: their two wins are a run.
    expect(longestWinStreak([a, b, c], at(a, c))).toBe(2);
    expect(longestWinStreak([a, b, c], at(a, b, c))).toBe(1);
  });

  it("is ended by a tie, counts forfeit wins, and is 0 with no wins", () => {
    const games = [
      g("2026-06-01", 5, 3),
      g("2026-06-08", 2, 2),
      g("2026-06-15", null, null, "Grand Slammers", "W"),
      g("2026-06-22", 8, 1),
    ];
    expect(longestWinStreak(games, everyGame)).toBe(2);
    expect(longestWinStreak([g("2026-06-01", 0, 1)], everyGame)).toBe(0);
    expect(longestWinStreak([], everyGame)).toBe(0);
  });
});

describe("bestGame", () => {
  it("picks the widest winning margin, then the most runs, then the latest", () => {
    const games = [
      g("2026-06-01", 5, 3, "A"),
      g("2026-06-08", 9, 2, "B"),
      g("2026-06-15", 12, 5, "C"),
      g("2026-06-22", 8, 1, "D"),
    ];
    // B, C and D all won by 7; C scored the most.
    expect(bestGame(games, everyGame)?.opponent).toBe("C");
    const level = [g("2026-06-01", 9, 2, "E"), g("2026-06-08", 9, 2, "F")];
    expect(bestGame(level, everyGame)?.opponent).toBe("F");
  });

  it("is the narrowest loss for a team that never won", () => {
    const games = [g("2026-06-01", 1, 9, "A"), g("2026-06-08", 4, 5, "B")];
    expect(bestGame(games, everyGame)).toMatchObject({
      opponent: "B",
      outcome: "L",
    });
  });

  it("ignores forfeits and games the player missed", () => {
    const forfeit = g("2026-06-01", null, null, "A", "W");
    const big = g("2026-06-08", 15, 0, "B");
    const small = g("2026-06-15", 3, 2, "C");
    expect(bestGame([forfeit, big, small], at(forfeit, small))?.opponent).toBe(
      "C",
    );
    expect(bestGame([forfeit], everyGame)).toBeNull();
  });
});

describe("biggestInning", () => {
  it("finds the biggest half-inning in games scored live", () => {
    const [a, b, c] = [
      g("2026-06-01", 5, 3, "A"),
      g("2026-06-08", 9, 2, "B"),
      g("2026-06-15", 4, 4, "C"),
    ];
    const innings = new Map([
      [a.gameId, [1, 0, 4]],
      [b.gameId, [0, 6, 3]],
    ]);
    expect(biggestInning([a, b, c], everyGame, innings)).toEqual({
      live: 2,
      best: { runs: 6, opponent: "B", day: "2026-06-08" },
    });
  });

  it("counts only the player's games and has no best when nobody scored", () => {
    const [a, b] = [g("2026-06-01", 0, 3, "A"), g("2026-06-08", 9, 2, "B")];
    const innings = new Map([
      [a.gameId, [0, 0, 0]],
      [b.gameId, [5, 4]],
    ]);
    expect(biggestInning([a, b], at(a), innings)).toEqual({
      live: 1,
      best: null,
    });
    expect(biggestInning([a, b], everyGame, new Map())).toEqual({
      live: 0,
      best: null,
    });
  });
});

describe("awardsWon", () => {
  const polls = [
    { id: "p1", title: "Summer 2026 MVP", team: false },
    { id: "p2", title: "Team spirit, Jul 12", team: true },
    { id: "p3", title: "Best sport, Jul 19", team: false },
  ];
  const me = { userId: "u1", teamSeasonId: "t1" };

  it("lists the polls the player won, ties included, and their team's", () => {
    const counts = [
      { pollId: "p1", nomineeId: "u1", votes: 3 },
      { pollId: "p1", nomineeId: "u2", votes: 3 },
      { pollId: "p2", nomineeId: "t1", votes: 5 },
      { pollId: "p2", nomineeId: "t2", votes: 2 },
      { pollId: "p3", nomineeId: "u2", votes: 4 },
      { pollId: "p3", nomineeId: "u1", votes: 1 },
    ];
    expect(awardsWon(polls, counts, me)).toEqual([
      { title: "Summer 2026 MVP", team: false },
      { title: "Team spirit, Jul 12", team: true },
    ]);
  });

  it("never matches a player id against a team award", () => {
    const counts = [{ pollId: "p2", nomineeId: "u1", votes: 2 }];
    expect(awardsWon(polls, counts, me)).toEqual([]);
  });
});

describe("buildCard", () => {
  const a = g("2026-06-01", 7, 3, "Sun Kickers");
  const b = g("2026-06-08", 2, 5, "Base Invaders");
  const c = g("2026-06-15", 11, 1, "Foul Play");
  const input = {
    playerName: "Robin Q.",
    seasonName: "Summer 2026",
    team: { name: "Pitch Please", slug: "pitch-please", colorHex: "#2A9D8F" },
    games: [a, b, c],
    player: at(a, c),
    innings: new Map([[c.gameId, [2, 6, 3]]]),
    record: { wins: 2, losses: 1, ties: 0 },
    finish: { rank: 2, of: 8, champion: false },
    awardsWon: [{ title: "Summer 2026 MVP", team: false }],
    votesCast: 3,
    sportsmanship: { average: 4.8, ratings: 5 },
    subGames: 0,
    league: { teams: 8, mostTeamRuns: 25, biggestInning: 6 },
  };

  it("adds up the player's season", () => {
    expect(buildCard(input)).toEqual({
      version: CARD_VERSION,
      playerName: "Robin Q.",
      seasonName: "Summer 2026",
      team: input.team,
      gamesPlayed: 3,
      attended: 2,
      runs: 18,
      liveGames: 1,
      biggestInning: { runs: 6, opponent: "Foul Play", day: "2026-06-15" },
      record: { wins: 2, losses: 1, ties: 0 },
      finish: { rank: 2, of: 8, champion: false },
      awardsWon: [{ title: "Summer 2026 MVP", team: false }],
      votesCast: 3,
      longestWinStreak: 2,
      bestGame: {
        day: "2026-06-15",
        opponent: "Foul Play",
        runsFor: 11,
        runsAgainst: 1,
        outcome: "W",
      },
      sportsmanship: { average: 4.8, ratings: 5 },
      subGames: 0,
      superlatives: ["Biggest inning in the league: 6 runs"],
    });
  });

  it("shows no attendance when it was not tracked", () => {
    const card = buildCard({ ...input, player: everyGame });
    expect(card.attended).toBeNull();
    expect(card.runs).toBe(20);
    expect(attendanceText(card)).toBeNull();
  });

  it("names nobody but the player and teams", () => {
    const card = buildCard(input);
    const text = JSON.stringify(card);
    expect(text).not.toMatch(/@|example\.test/);
    expect(Object.keys(card)).not.toContain("votedFor");
  });

  it("reads as short highlights for the pages and the WhatsApp text", () => {
    expect(highlights(buildCard(input))).toEqual([
      "Pitch Please: 2-1, 2nd of 8",
      "Showed up for 2 of 3 games",
      "18 runs for the team",
      "2-game win streak",
      "Won Summer 2026 MVP",
      "Best game: W 11–1 vs Foul Play",
      "Sportsmanship shout-out: other captains rated your team 4.8 out of 5",
      "Biggest inning in the league: 6 runs",
    ]);
  });
});

describe("text helpers", () => {
  it("formats records, finishes and games", () => {
    expect(recordText({ wins: 4, losses: 2, ties: 0 })).toBe("4-2");
    expect(recordText({ wins: 4, losses: 2, ties: 1 })).toBe("4-2-1");
    expect(finishText({ rank: 1, of: 6, champion: true })).toBe("Champions");
    expect(finishText({ rank: 3, of: 6, champion: false })).toBe("3rd of 6");
    expect(finishText(null)).toBeNull();
    expect(
      gameLine({
        day: "2026-06-01",
        opponent: "Sun Kickers",
        runsFor: 2,
        runsAgainst: 2,
        outcome: "T",
      }),
    ).toBe("T 2–2 vs Sun Kickers");
  });

  it("counts a record", () => {
    expect(
      recordOf([
        g("2026-06-01", 1, 0),
        g("2026-06-02", 0, 0),
        g("2026-06-03", 0, 1),
      ]),
    ).toEqual({ wins: 1, losses: 1, ties: 1 });
  });

  it("knows a stored card of this version", () => {
    expect(isCurrentCard({ version: CARD_VERSION })).toBe(true);
    expect(isCurrentCard({ version: 0 })).toBe(false);
    expect(isCurrentCard(null)).toBe(false);
  });
});

describe("a player with no games", () => {
  it("still gets a calm card with nothing earned", () => {
    const card = buildCard({
      playerName: "New P.",
      seasonName: "Summer 2026",
      team: { name: "Pitch Please", slug: "pitch-please", colorHex: null },
      games: [],
      player: { attended: new Set(), tracked: false },
      innings: new Map(),
      record: { wins: 0, losses: 0, ties: 0 },
      finish: null,
      awardsWon: [],
      votesCast: 0,
      sportsmanship: null,
      subGames: 0,
      league: { teams: 8, mostTeamRuns: 30, biggestInning: 7 },
    });
    expect(card).toMatchObject({
      gamesPlayed: 0,
      attended: null,
      runs: 0,
      longestWinStreak: 0,
      bestGame: null,
      biggestInning: null,
      superlatives: [],
    });
    expect(highlights(card)).toEqual(["Pitch Please: 0-0", "Played 0 games"]);
  });

  it("never claims a perfect attendance for an empty season", () => {
    expect(
      superlatives({
        games: [],
        player: { attended: new Set(), tracked: true },
        attended: 0,
        biggestInningRuns: 0,
        subGames: 0,
        league: { teams: 2, mostTeamRuns: 0, biggestInning: 0 },
      }),
    ).toEqual([]);
  });
});

describe("sportsmanshipShout", () => {
  it("needs enough ratings and a high average", () => {
    expect(sportsmanshipShout(null)).toBeNull();
    expect(sportsmanshipShout({ average: 5, ratings: 2 })).toBeNull();
    expect(sportsmanshipShout({ average: 4.4, ratings: 9 })).toBeNull();
    expect(sportsmanshipShout({ average: 4.5, ratings: 3 })).toMatch(
      /4\.5 out of 5/,
    );
  });
});

describe("superlatives", () => {
  const league = { teams: 4, mostTeamRuns: 20, biggestInning: 6 };
  const base = {
    biggestInningRuns: 0,
    subGames: 0,
    attended: null,
    league,
  };

  it("compares the team and games with the league, never naming anyone", () => {
    const games = [
      g("2026-06-01", 10, 9),
      g("2026-06-08", 6, 5),
      g("2026-06-15", 4, 6),
    ];
    expect(superlatives({ ...base, games, player: everyGame })).toEqual([
      "Highest-scoring team in the league",
      "Cardiac kid: 2 wins by a single run",
    ]);
  });

  it("needs two teams to be the highest-scoring one", () => {
    const games = [g("2026-06-01", 10, 0)];
    expect(
      superlatives({
        ...base,
        games,
        player: everyGame,
        league: { teams: 1, mostTeamRuns: 10, biggestInning: 0 },
      }),
    ).toEqual([]);
  });

  it("rewards a perfect record of showing up, but not for a short season", () => {
    const three = [
      g("2026-06-01", 1, 2),
      g("2026-06-08", 1, 2),
      g("2026-06-15", 1, 2),
    ];
    expect(
      superlatives({
        ...base,
        games: three,
        player: at(...three),
        attended: 3,
      }),
    ).toEqual(["Never missed a game"]);
    expect(
      superlatives({
        ...base,
        games: three.slice(0, 2),
        player: at(...three.slice(0, 2)),
        attended: 2,
      }),
    ).toEqual([]);
  });

  it("counts a sub's fill-ins and keeps at most three marks", () => {
    const games = [g("2026-06-01", 10, 9), g("2026-06-08", 6, 5)];
    const lines = superlatives({
      games,
      player: at(...games),
      attended: 2,
      biggestInningRuns: 6,
      subGames: 1,
      league,
    });
    expect(lines).toHaveLength(3);
    expect(
      superlatives({ ...base, games: [], player: everyGame, subGames: 2 }),
    ).toEqual(["Filled in for other teams 2 times"]);
  });

  it("counts one-run wins the player was at", () => {
    const [a, b] = [g("2026-06-01", 2, 1), g("2026-06-08", 3, 2)];
    expect(closeWins([a, b], at(a))).toBe(1);
    expect(closeWins([a, b], everyGame)).toBe(2);
  });
});
