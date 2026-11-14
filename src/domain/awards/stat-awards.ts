/**
 * Stat awards (ADR 0046): season awards worked out from what the app
 * records, each with a formula the awards page prints in full. Everything
 * here is pure; src/db/queries/stat-awards.ts gathers the inputs and saves
 * the results.
 *
 * The app does not record who scored a run, only the runs each team scored
 * in each half-inning of a live-scored game. A player's runs are therefore
 * their team's runs in the live-scored games they played, and every page
 * says so.
 */
import { err, ok, type Result } from "../result";

/** How many recorded games a stat needs before it is shown. */
export const MIN_GAMES = 3;

/**
 * Whether `recorded` games out of `of` are enough to show a stat: at least
 * MIN_GAMES, and at least half of them.
 */
export function enoughGames(recorded: number, of: number): boolean {
  return recorded >= MIN_GAMES && recorded * 2 >= of;
}

/** "based on 7 of 9 games". */
export function coverageNote(recorded: number, of: number): string {
  return `based on ${recorded} of ${of} game${of === 1 ? "" : "s"}`;
}

/**
 * What the app knows about one player at one of their team's final games.
 * A saved kicking order decides it; without one, the player's RSVP; without
 * that, a bar check-in that day counts as being there. Otherwise unknown.
 */
export type Attendance = "played" | "missed" | "unknown";

export function attendanceAt(evidence: {
  lineupSaved: boolean;
  inLineup: boolean;
  rsvp: "in" | "out" | "maybe" | null;
  checkedInThatDay: boolean;
}): Attendance {
  if (evidence.lineupSaved) return evidence.inLineup ? "played" : "missed";
  if (evidence.rsvp === "in") return "played";
  if (evidence.rsvp === "out") return "missed";
  return evidence.checkedInThatDay ? "played" : "unknown";
}

export type PlayerGame = {
  attendance: Attendance;
  /** The player's team won it. */
  won: boolean;
  /** The team's runs from live scoring; null if the game wasn't live scored. */
  liveRuns: number | null;
  /** Average sportsmanship rating the team got for this game, if any. */
  rating: number | null;
};

/** One player's season, as gathered from the database. */
export type PlayerSeason = {
  userId: string;
  /** Final games of the player's team. */
  games: readonly PlayerGame[];
  /** Approved sub claims for other teams' final games. */
  subAppearances: number;
  mvpVotes: number;
  bestSportVotes: number;
  /** No registration in an earlier season. */
  firstSeason: boolean;
};

export type SeasonStats = {
  userId: string;
  teamGames: number;
  /** Games whose attendance the app recorded. */
  recorded: number;
  gamesPlayed: number;
  /** Played / recorded, or null when too few games were recorded. */
  attendanceRate: number | null;
  /** Wins in games played; shown with the attendance coverage. */
  wins: number;
  /** Played games that were live scored. */
  liveGames: number;
  /** Team runs in those games, however few there were. */
  liveRuns: number;
  /** Team runs in live-scored games played; null without enough of them. */
  runs: number | null;
  subAppearances: number;
  /** Games played that the other captain rated. */
  ratedGames: number;
  /** Average rating in games played; null without enough of them. */
  sportsmanship: number | null;
};

export function seasonStats(p: PlayerSeason): SeasonStats {
  const recordedGames = p.games.filter((g) => g.attendance !== "unknown");
  const played = p.games.filter((g) => g.attendance === "played");
  const live = played.filter((g) => g.liveRuns !== null);
  const rated = played.filter((g) => g.rating !== null);
  const attendanceShown = enoughGames(recordedGames.length, p.games.length);
  const liveRuns = live.reduce((sum, g) => sum + (g.liveRuns ?? 0), 0);
  return {
    userId: p.userId,
    teamGames: p.games.length,
    recorded: recordedGames.length,
    gamesPlayed: played.length,
    attendanceRate: attendanceShown
      ? played.length / recordedGames.length
      : null,
    wins: played.filter((g) => g.won).length,
    liveGames: live.length,
    liveRuns,
    runs: enoughGames(live.length, played.length) ? liveRuns : null,
    subAppearances: p.subAppearances,
    ratedGames: rated.length,
    sportsmanship: enoughGames(rated.length, played.length)
      ? rated.reduce((sum, g) => sum + (g.rating ?? 0), 0) / rated.length
      : null,
  };
}

/** Career totals: counts add up; rates are worked out from the totals. */
export type CareerStats = {
  seasons: number;
  teamGames: number;
  recorded: number;
  gamesPlayed: number;
  attendanceRate: number | null;
  wins: number;
  liveGames: number;
  runs: number | null;
  subAppearances: number;
};

export function careerStats(seasons: readonly SeasonStats[]): CareerStats {
  const sum = (f: (s: SeasonStats) => number) =>
    seasons.reduce((n, s) => n + f(s), 0);
  const teamGames = sum((s) => s.teamGames);
  const recorded = sum((s) => s.recorded);
  const gamesPlayed = sum((s) => s.gamesPlayed);
  const liveGames = sum((s) => s.liveGames);
  return {
    seasons: seasons.length,
    teamGames,
    recorded,
    gamesPlayed,
    attendanceRate: enoughGames(recorded, teamGames)
      ? gamesPlayed / recorded
      : null,
    wins: sum((s) => s.wins),
    liveGames,
    runs: enoughGames(liveGames, gamesPlayed) ? sum((s) => s.liveRuns) : null,
    subAppearances: sum((s) => s.subAppearances),
  };
}

export type StatAward =
  | "season_mvp"
  | "iron_kicker"
  | "golden_boot"
  | "best_teammate"
  | "rookie_of_the_year"
  | "sub_of_the_year";

/** Each award's name, a line about it, and its formula in words. */
export const STAT_AWARDS: Record<
  StatAward,
  { label: string; blurb: string; formula: string; unit: string }
> = {
  season_mvp: {
    label: "Season MVP",
    blurb: "The season's most valuable player, by the numbers and the vote.",
    formula:
      "A score out of 100 from four parts: runs per live-scored game, wins while playing (as a share of the team's games), attendance rate, and share of the season MVP vote. Each part is the player's number divided by the season's best, then the parts are weighted as shown. A part a player has too little data for counts at the season's average for that part, so missing data neither helps nor hurts. Players need at least 3 games played.",
    unit: "points",
  },
  iron_kicker: {
    label: "Iron Kicker",
    blurb: "Showed up, week after week.",
    formula:
      "The best attendance rate: games played divided by the team's games whose attendance was recorded (from the kicking order, RSVPs and bar check-ins). A tie on the rate goes to whoever played more games.",
    unit: "attendance",
  },
  golden_boot: {
    label: "Golden Boot",
    blurb: "The most runs crossed the plate with them on the field.",
    formula:
      "The most runs while playing: the team's runs in every live-scored game the player played. The app records runs by half-inning, not by kicker.",
    unit: "runs",
  },
  best_teammate: {
    label: "Best Teammate",
    blurb: "Fair, friendly and fun to play with and against.",
    formula:
      "A score out of 100, half from the average sportsmanship rating other captains gave the team in games the player played, half from best-sport votes across the season's closed polls. Each half is the player's number divided by the season's best; a player with too few rated games gets the season's average rating part. Players need at least 3 games played.",
    unit: "points",
  },
  rookie_of_the_year: {
    label: "Rookie of the Year",
    blurb: "The best first season in the league.",
    formula:
      "The best Season MVP score among players in their first season with the league.",
    unit: "points",
  },
  sub_of_the_year: {
    label: "Sub of the Year",
    blurb: "Always ready to fill a spot for another team.",
    formula:
      "The most sub appearances: approved sub spots in other teams' final games.",
    unit: "sub games",
  },
};

export const STAT_AWARD_KEYS = Object.keys(STAT_AWARDS) as StatAward[];
export const isStatAward = (value: string): value is StatAward =>
  Object.hasOwn(STAT_AWARDS, value);

/** The Season MVP's weights, each 0 to 10 (an admin setting). */
export type MvpWeights = {
  runs: number;
  wins: number;
  attendance: number;
  votes: number;
};
export const MVP_PARTS = ["runs", "wins", "attendance", "votes"] as const;
export type MvpPart = (typeof MVP_PARTS)[number];
/**
 * Runs and wins are the team's, so teammates share them; attendance and
 * votes are the player's own. The default gives the player's own parts
 * the larger share (ADR 0046).
 */
export const DEFAULT_MVP_WEIGHTS: MvpWeights = {
  runs: 2,
  wins: 2,
  attendance: 2,
  votes: 4,
};
export const MVP_PART_LABELS: Record<MvpPart, string> = {
  runs: "Runs per live-scored game",
  wins: "Wins while playing",
  attendance: "Attendance rate",
  votes: "MVP vote share",
};
export const WEIGHT_MAX = 10;

export type WeightsError = "bad_weight" | "all_zero";

/** An admin's weights form, checked: whole numbers 0 to 10, not all zero. */
export function parseWeights(
  form: Record<MvpPart, string>,
): Result<MvpWeights, WeightsError> {
  const out = { ...DEFAULT_MVP_WEIGHTS };
  for (const part of MVP_PARTS) {
    const raw = form[part].trim();
    if (!/^\d{1,2}$/.test(raw)) return err("bad_weight");
    const n = Number(raw);
    if (n > WEIGHT_MAX) return err("bad_weight");
    out[part] = n;
  }
  return MVP_PARTS.some((p) => out[p] > 0) ? ok(out) : err("all_zero");
}

/** A person on an award's leaderboard. Ties share a place. */
export type Leader = { userId: string; value: number; place: number };

/** Values are compared as shown: scores and rates to one decimal place. */
export const shown = (value: number) => Math.round(value * 10) / 10;

/**
 * Places for a leaderboard, best first: equal values share a place and the
 * next place skips ahead (1, 1, 3). An award with a published tie-break
 * gives each entry a `tiebreak` (higher is better), and only a tie on both
 * is shared. Keeps everyone placed `keep` or better, ties included, and
 * only values above zero. Tied people are listed by id so the order is
 * stable.
 */
export function rank(
  entries: readonly { userId: string; value: number; tiebreak?: number }[],
  keep = 3,
): Leader[] {
  const sorted = entries
    .map((e) => ({
      userId: e.userId,
      value: shown(e.value),
      tiebreak: e.tiebreak ?? 0,
    }))
    .filter((e) => e.value > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.tiebreak - a.tiebreak ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
  const out: Leader[] = [];
  sorted.forEach((e, i) => {
    const previous = sorted[i - 1];
    const place =
      previous && previous.value === e.value && previous.tiebreak === e.tiebreak
        ? (out[i - 1]?.place ?? i + 1)
        : i + 1;
    out.push({ userId: e.userId, value: e.value, place });
  });
  return out.filter((l) => l.place <= keep);
}

/** Winners: everyone in first place. */
export const winnersOf = (leaders: readonly Leader[]) =>
  leaders.filter((l) => l.place === 1).map((l) => l.userId);

/**
 * A weighted score out of 100 from parts already scaled 0 to 1. Parts
 * that are null are left out and the rest share their weight; with no
 * weighted part left the score is null.
 */
export function weightedScore(
  parts: Record<string, number | null>,
  weights: Record<string, number>,
): number | null {
  let total = 0;
  let weight = 0;
  for (const [key, value] of Object.entries(parts)) {
    const w = weights[key] ?? 0;
    if (value === null || w === 0) continue;
    total += w * value;
    weight += w;
  }
  return weight === 0 ? null : (100 * total) / weight;
}

/** `value / best`, or null when there is no value or no best above zero. */
const scaled = (value: number | null, best: number) =>
  value === null || best <= 0 ? null : value / best;

const best = (values: readonly (number | null)[]) =>
  Math.max(0, ...values.filter((v): v is number => v !== null));

/**
 * Fills each missing value with the average of the others, so a player
 * without enough data for a part sits at the season's average for it.
 * With no values at all, everything stays null.
 */
export function fillWithAverage(
  values: readonly (number | null)[],
): (number | null)[] {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return [...values];
  const average = known.reduce((a, b) => a + b, 0) / known.length;
  return values.map((v) => v ?? average);
}

export type MvpBreakdown = {
  userId: string;
  score: number | null;
  /** Each part's raw number (null when the season's average was used). */
  parts: Record<MvpPart, number | null>;
};

export type AwardsResult = {
  weights: MvpWeights;
  /** Parts nobody had data for, so no one's score used them. */
  unusedParts: MvpPart[];
  /** Whether a season MVP poll's votes were counted. */
  votesCounted: boolean;
  leaders: Record<StatAward, Leader[]>;
  mvp: MvpBreakdown[];
  stats: SeasonStats[];
};

/**
 * Every stat award for a season, from each player's season. Players who
 * opted out of public leaderboards are left out before this is called.
 */
export function computeAwards(
  players: readonly PlayerSeason[],
  weights: MvpWeights,
): AwardsResult {
  const stats = players.map(seasonStats);
  const byId = new Map(players.map((p) => [p.userId, p]));
  const mvpVoteTotal = players.reduce((n, p) => n + p.mvpVotes, 0);
  const votesCounted = mvpVoteTotal > 0;
  // Iron Kicker needs the attendance coverage; MVP, Rookie and Best
  // Teammate also need MIN_GAMES played.
  const recorded = stats.filter((s) => s.attendanceRate !== null);
  const eligible = recorded.filter((s) => s.gamesPlayed >= MIN_GAMES);

  const raw = eligible.map((s) => {
    const p = byId.get(s.userId);
    return {
      userId: s.userId,
      parts: {
        runs: s.runs === null ? null : s.runs / s.liveGames,
        wins: s.teamGames === 0 ? null : s.wins / s.teamGames,
        attendance: s.attendanceRate,
        votes: votesCounted && p ? p.mvpVotes / mvpVoteTotal : null,
      } satisfies Record<MvpPart, number | null>,
    };
  });
  const bests = Object.fromEntries(
    MVP_PARTS.map((part) => [part, best(raw.map((r) => r.parts[part]))]),
  ) as Record<MvpPart, number>;
  const unusedParts = MVP_PARTS.filter((part) => bests[part] <= 0);
  const filled = Object.fromEntries(
    MVP_PARTS.map((part) => [
      part,
      fillWithAverage(raw.map((r) => scaled(r.parts[part], bests[part]))),
    ]),
  ) as Record<MvpPart, (number | null)[]>;
  const mvp: MvpBreakdown[] = raw.map((r, i) => ({
    userId: r.userId,
    parts: r.parts,
    score: weightedScore(
      Object.fromEntries(
        MVP_PARTS.map((part) => [part, filled[part][i] ?? null]),
      ),
      weights,
    ),
  }));
  const mvpEntries = mvp.flatMap((m) =>
    m.score === null ? [] : [{ userId: m.userId, value: m.score }],
  );

  const bestSportBest = best(players.map((p) => p.bestSportVotes));
  const ratingBest = best(eligible.map((s) => s.sportsmanship));
  const ratings = fillWithAverage(
    eligible.map((s) => scaled(s.sportsmanship, ratingBest)),
  );
  const teammate = eligible.flatMap((s, i) => {
    const score = weightedScore(
      {
        rating: ratings[i] ?? null,
        votes: scaled(byId.get(s.userId)?.bestSportVotes ?? 0, bestSportBest),
      },
      { rating: 1, votes: 1 },
    );
    return score === null ? [] : [{ userId: s.userId, value: score }];
  });

  return {
    weights,
    unusedParts,
    votesCounted,
    stats,
    mvp,
    leaders: {
      season_mvp: rank(mvpEntries),
      iron_kicker: rank(
        recorded.map((s) => ({
          userId: s.userId,
          value: 100 * (s.attendanceRate ?? 0),
          tiebreak: s.gamesPlayed,
        })),
      ),
      golden_boot: rank(
        stats.flatMap((s) =>
          s.runs === null ? [] : [{ userId: s.userId, value: s.runs }],
        ),
      ),
      best_teammate: rank(teammate),
      rookie_of_the_year: rank(
        mvpEntries.filter((e) => byId.get(e.userId)?.firstSeason),
      ),
      sub_of_the_year: rank(
        stats.map((s) => ({ userId: s.userId, value: s.subAppearances })),
      ),
    },
  };
}

/** An award's value as shown: "87.5 points", "92.3%", "41 runs". */
export function formatValue(award: StatAward, value: number): string {
  switch (award) {
    case "iron_kicker":
      return `${shown(value)}%`;
    case "golden_boot":
      return `${value} run${value === 1 ? "" : "s"}`;
    case "sub_of_the_year":
      return `${value} sub game${value === 1 ? "" : "s"}`;
    default:
      return `${shown(value)} points`;
  }
}

/**
 * An MVP score's parts in words: "9.7 runs a game · 75% of team games won
 * · …", naming the parts that used the season's average. Parts nobody had
 * data for (`unused`) are left out.
 */
export function partsLine(
  parts: Record<MvpPart, number | null>,
  unused: readonly MvpPart[] = [],
): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const words: Record<MvpPart, (n: number) => string> = {
    runs: (n) => `${shown(n)} runs a game`,
    wins: (n) => `${pct(n)} of team games won`,
    attendance: (n) => `${pct(n)} attendance`,
    votes: (n) => `${pct(n)} of MVP votes`,
  };
  const short: Record<MvpPart, string> = {
    runs: "runs",
    wins: "wins",
    attendance: "attendance",
    votes: "votes",
  };
  const averaged = MVP_PARTS.filter(
    (part) => parts[part] === null && !unused.includes(part),
  );
  return [
    ...MVP_PARTS.flatMap((part) => {
      const value = parts[part];
      return value === null ? [] : [words[part](value)];
    }),
    ...(averaged.length
      ? [`season average for ${averaged.map((p) => short[p]).join(" and ")}`]
      : []),
  ].join(" · ");
}

export const NOTE_MAX = 280;

/** An admin's note on an award: trimmed, one line, at most NOTE_MAX. */
export function parseNote(raw: string): Result<string | null, "note_too_long"> {
  const note = raw.trim().replace(/\s+/g, " ");
  if (note.length > NOTE_MAX) return err("note_too_long");
  return ok(note === "" ? null : note);
}

/**
 * The poll categories a stat award can suggest nominees for: a season
 * MVP poll gets the MVP leaders, best sport gets Best Teammate's, best
 * newcomer gets the rookies.
 */
export const SUGGESTS_FOR: Partial<Record<string, StatAward>> = {
  mvp: "season_mvp",
  best_sport: "best_teammate",
  newcomer: "rookie_of_the_year",
};
