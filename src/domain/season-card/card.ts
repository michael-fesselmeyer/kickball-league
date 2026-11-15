import { tally } from "../awards/awards";
import { ordinal } from "../share/cards";

/**
 * "Your season in kickball": one player's end-of-season card
 * (docs/product-spec.md). Built once from the closed season's games, RSVPs,
 * lineups, live scoring and awards, and stored as plain data, so the card
 * reads the same every time it is opened or shared. Pure functions only;
 * src/db/queries/season-cards.ts gathers the inputs.
 *
 * Privacy: a card is about one player. Opponents appear as team names, and
 * votes are counted, never said who for. The player's own name is first
 * name and last initial, as on the public team page.
 */

/** Bumped when the stored shape changes; older cards are rebuilt. */
export const CARD_VERSION = 2;

export type Outcome = "W" | "L" | "T";

/** One of the player's team's finished games, from the team's side. */
export type TeamGame = {
  gameId: string;
  /** The game day, YYYY-MM-DD in the league's time zone. */
  day: string;
  opponent: string;
  playoff: boolean;
  /** Null for a forfeit, which has no score. */
  runsFor: number | null;
  runsAgainst: number | null;
  outcome: Outcome;
};

/** What the database holds about the player's games. */
export type PlayerInputs = {
  /** Games the player said they were in for, or kicked in. */
  attended: ReadonlySet<string>;
  /**
   * Whether the player answered or kicked in any game at all. A player
   * whose team never used RSVPs or lineups has no attendance to show, and
   * every team game counts as theirs.
   */
  tracked: boolean;
};

/** The team's runs in each half-inning entered live, by game. */
export type LiveInnings = ReadonlyMap<string, readonly number[]>;

export type Finish = {
  rank: number;
  of: number;
  champion: boolean;
};

export type CardGame = {
  day: string;
  opponent: string;
  runsFor: number;
  runsAgainst: number;
  outcome: Outcome;
};

export type CardAward = { title: string; team: boolean };

/** What other captains rated the player's team, over the whole season. */
export type Sportsmanship = { average: number; ratings: number };

/** A team needs this many ratings and this average to earn the shout-out. */
export const SHOUT_MIN_RATINGS = 3;
export const SHOUT_MIN_AVERAGE = 4.5;

/** League-wide marks the superlatives are measured against. */
export type LeagueMarks = {
  /** Teams that played a finished game. */
  teams: number;
  /** The most runs any team scored in the regular season and playoffs. */
  mostTeamRuns: number;
  /** The biggest half-inning any team scored in a live-scored game. */
  biggestInning: number;
};

/** A season needs this many games for "never missed" to mean something. */
export const PERFECT_MIN_GAMES = 3;
/** One-run wins it takes to be "cardiac". */
export const CLOSE_WINS = 2;

/** The stored card: everything the pages and the share image show. */
export type SeasonCardStats = {
  version: typeof CARD_VERSION;
  playerName: string;
  seasonName: string;
  team: { name: string; slug: string; colorHex: string | null };
  /** The team's finished games, playoffs included. */
  gamesPlayed: number;
  /** Null when attendance was not tracked for this player. */
  attended: number | null;
  /** Runs the team scored in the games the player was part of. */
  runs: number;
  /** Of those games, how many were scored live inning by inning. */
  liveGames: number;
  biggestInning: { runs: number; opponent: string; day: string } | null;
  record: { wins: number; losses: number; ties: number };
  finish: Finish | null;
  awardsWon: CardAward[];
  /** Award polls the player voted in. */
  votesCast: number;
  /** The longest run of wins the player played in, skipping games missed. */
  longestWinStreak: number;
  bestGame: CardGame | null;
  /** Other captains' sportsmanship ratings of the team; null when unrated. */
  sportsmanship: Sportsmanship | null;
  /** Games the player filled in for another team, as a sub. */
  subGames: number;
  /** Playful league-wide marks the player earned, at most three. */
  superlatives: string[];
};

/** The games that count as the player's: the ones they were at. */
export function playerGames(
  games: readonly TeamGame[],
  player: PlayerInputs,
): TeamGame[] {
  return player.tracked
    ? games.filter((g) => player.attended.has(g.gameId))
    : [...games];
}

/** Oldest first; games on the same day keep their given order. */
export function chronological(games: readonly TeamGame[]): TeamGame[] {
  return games
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.day.localeCompare(b.g.day) || a.i - b.i)
    .map(({ g }) => g);
}

/**
 * The longest run of team wins the player played in. A game the player
 * missed is neither theirs to win nor to lose, so it is skipped; a loss or
 * a tie they played in ends the run.
 */
export function longestWinStreak(
  games: readonly TeamGame[],
  player: PlayerInputs,
): number {
  let best = 0;
  let current = 0;
  for (const g of chronological(playerGames(games, player))) {
    current = g.outcome === "W" ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

/**
 * The player's best game: the widest winning margin (the narrowest loss
 * when they never won), then the most runs scored, then the latest.
 * Forfeits have no score and never count.
 */
export function bestGame(
  games: readonly TeamGame[],
  player: PlayerInputs,
): CardGame | null {
  let best: CardGame | null = null;
  for (const g of chronological(playerGames(games, player))) {
    if (g.runsFor === null || g.runsAgainst === null) continue;
    const candidate: CardGame = {
      day: g.day,
      opponent: g.opponent,
      runsFor: g.runsFor,
      runsAgainst: g.runsAgainst,
      outcome: g.outcome,
    };
    if (!best || better(candidate, best)) best = candidate;
  }
  return best;
}

const margin = (g: CardGame) => g.runsFor - g.runsAgainst;

/** Later games win ties, so `>=` on the same margin and runs. */
function better(a: CardGame, b: CardGame): boolean {
  if (margin(a) !== margin(b)) return margin(a) > margin(b);
  return a.runsFor >= b.runsFor;
}

/** The team's biggest half-inning in the player's games, scored live. */
export function biggestInning(
  games: readonly TeamGame[],
  player: PlayerInputs,
  innings: LiveInnings,
): { live: number; best: SeasonCardStats["biggestInning"] } {
  let live = 0;
  let best: SeasonCardStats["biggestInning"] = null;
  for (const g of chronological(playerGames(games, player))) {
    const halves = innings.get(g.gameId);
    if (!halves || halves.length === 0) continue;
    live++;
    const most = Math.max(...halves);
    if (most > 0 && (!best || most >= best.runs))
      best = { runs: most, opponent: g.opponent, day: g.day };
  }
  return { live, best };
}

export type ClosedPoll = {
  id: string;
  title: string;
  /** A team award names the team; a player award names a person. */
  team: boolean;
};

/**
 * The closed polls the player won, or their team won: everyone tied for
 * the most votes wins, as on the results page.
 */
export function awardsWon(
  polls: readonly ClosedPoll[],
  counts: readonly { pollId: string; nomineeId: string; votes: number }[],
  me: { userId: string; teamSeasonId: string },
): CardAward[] {
  return polls.flatMap((poll) => {
    const { winners } = tally(counts.filter((c) => c.pollId === poll.id));
    const mine = poll.team ? me.teamSeasonId : me.userId;
    return winners.includes(mine)
      ? [{ title: poll.title, team: poll.team }]
      : [];
  });
}

/** Wins, losses and ties in the given games. */
export function recordOf(games: readonly TeamGame[]) {
  const count = (o: Outcome) => games.filter((g) => g.outcome === o).length;
  return { wins: count("W"), losses: count("L"), ties: count("T") };
}

/** Wins by a single run in the player's games. */
export function closeWins(
  games: readonly TeamGame[],
  player: PlayerInputs,
): number {
  return playerGames(games, player).filter(
    (g) =>
      g.outcome === "W" &&
      g.runsFor !== null &&
      g.runsAgainst !== null &&
      g.runsFor - g.runsAgainst === 1,
  ).length;
}

/**
 * The shout-out for a team the league's captains rated well: enough ratings
 * and a high average. Null otherwise, including with no ratings.
 */
export function sportsmanshipShout(s: Sportsmanship | null): string | null {
  if (!s || s.ratings < SHOUT_MIN_RATINGS || s.average < SHOUT_MIN_AVERAGE)
    return null;
  return `Sportsmanship shout-out: other captains rated your team ${s.average.toFixed(1)} out of 5`;
}

/**
 * Playful marks measured against the league, each earned or left out, most
 * fun first, three at most. They compare the player's team and games with
 * the rest of the league; no other team or player is named.
 */
export function superlatives(input: {
  games: readonly TeamGame[];
  player: PlayerInputs;
  attended: number | null;
  biggestInningRuns: number;
  subGames: number;
  league: LeagueMarks;
}): string[] {
  const lines: string[] = [];
  const teamRuns = input.games.reduce((sum, g) => sum + (g.runsFor ?? 0), 0);
  if (
    input.league.teams >= 2 &&
    teamRuns > 0 &&
    teamRuns === input.league.mostTeamRuns
  )
    lines.push("Highest-scoring team in the league");
  if (
    input.biggestInningRuns > 0 &&
    input.biggestInningRuns === input.league.biggestInning
  )
    lines.push(`Biggest inning in the league: ${input.biggestInningRuns} runs`);
  if (
    input.attended !== null &&
    input.games.length >= PERFECT_MIN_GAMES &&
    input.attended === input.games.length
  )
    lines.push("Never missed a game");
  const close = closeWins(input.games, input.player);
  if (close >= CLOSE_WINS)
    lines.push(`Cardiac kid: ${close} wins by a single run`);
  if (input.subGames > 0)
    lines.push(
      `Filled in for other teams ${input.subGames} ${input.subGames === 1 ? "time" : "times"}`,
    );
  return lines.slice(0, 3);
}

export type CardInputs = {
  playerName: string;
  seasonName: string;
  team: SeasonCardStats["team"];
  games: readonly TeamGame[];
  player: PlayerInputs;
  innings: LiveInnings;
  /** The regular-season record from the standings. */
  record: SeasonCardStats["record"];
  finish: Finish | null;
  awardsWon: readonly CardAward[];
  votesCast: number;
  sportsmanship: Sportsmanship | null;
  subGames: number;
  league: LeagueMarks;
};

/** The whole card for one player. */
export function buildCard(input: CardInputs): SeasonCardStats {
  const mine = playerGames(input.games, input.player);
  const live = biggestInning(input.games, input.player, input.innings);
  const attended = input.player.tracked ? mine.length : null;
  return {
    version: CARD_VERSION,
    playerName: input.playerName,
    seasonName: input.seasonName,
    team: input.team,
    gamesPlayed: input.games.length,
    attended,
    runs: mine.reduce((sum, g) => sum + (g.runsFor ?? 0), 0),
    liveGames: live.live,
    biggestInning: live.best,
    record: input.record,
    finish: input.finish,
    awardsWon: [...input.awardsWon],
    votesCast: input.votesCast,
    longestWinStreak: longestWinStreak(input.games, input.player),
    bestGame: bestGame(input.games, input.player),
    sportsmanship: input.sportsmanship,
    subGames: input.subGames,
    superlatives: superlatives({
      games: input.games,
      player: input.player,
      attended,
      biggestInningRuns: live.best?.runs ?? 0,
      subGames: input.subGames,
      league: input.league,
    }),
  };
}

/** "3-1-1"; the tie count only when there were ties. */
export function recordText(r: SeasonCardStats["record"]): string {
  return r.ties > 0
    ? `${r.wins}-${r.losses}-${r.ties}`
    : `${r.wins}-${r.losses}`;
}

/** "Champions", or "2nd of 8". */
export function finishText(f: Finish | null): string | null {
  if (!f) return null;
  return f.champion ? "Champions" : `${ordinal(f.rank)} of ${f.of}`;
}

/** "9 of 10 games", or null when attendance was not tracked. */
export function attendanceText(stats: SeasonCardStats): string | null {
  if (stats.attended === null) return null;
  return `${stats.attended} of ${stats.gamesPlayed} ${stats.gamesPlayed === 1 ? "game" : "games"}`;
}

/** "W 12–3 vs Sun Kickers" */
export function gameLine(g: CardGame): string {
  return `${g.outcome} ${g.runsFor}–${g.runsAgainst} vs ${g.opponent}`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The card's headline facts, most interesting first, each a short line.
 * The pages, the share image and the WhatsApp text all read from this, so
 * they never disagree.
 */
export function highlights(stats: SeasonCardStats): string[] {
  const lines: string[] = [];
  const finish = finishText(stats.finish);
  lines.push(
    `${stats.team.name}: ${recordText(stats.record)}${finish ? `, ${finish}` : ""}`,
  );
  const attendance = attendanceText(stats);
  if (attendance) lines.push(`Showed up for ${attendance}`);
  else lines.push(`Played ${plural(stats.gamesPlayed, "game")}`);
  if (stats.runs > 0) lines.push(`${plural(stats.runs, "run")} for the team`);
  if (stats.longestWinStreak >= 2)
    lines.push(`${stats.longestWinStreak}-game win streak`);
  for (const a of stats.awardsWon)
    lines.push(a.team ? `Team award: ${a.title}` : `Won ${a.title}`);
  if (stats.bestGame) lines.push(`Best game: ${gameLine(stats.bestGame)}`);
  const shout = sportsmanshipShout(stats.sportsmanship);
  if (shout) lines.push(shout);
  lines.push(...stats.superlatives);
  return lines;
}

/** Whether a stored value is a card this code can show. */
export function isCurrentCard(value: unknown): value is SeasonCardStats {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === CARD_VERSION
  );
}
