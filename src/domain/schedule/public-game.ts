/**
 * A game as the public pages and calendar feeds show it: where the
 * published schedule version places it, and its result. Built by
 * src/db/queries/public-schedule.ts.
 */

export type PublicTeam = {
  /** The team's entry in this season (team_season). */
  id: string;
  name: string;
  slug: string;
  colorHex: string | null;
};

export type PublicGame = {
  id: string;
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  /** The published version this placement comes from. */
  versionNo: number;
  roundNo: number | null;
  kind: "regular" | "playoff" | "exhibition";
  status:
    | "scheduled"
    | "in_progress"
    | "final"
    | "postponed"
    | "cancelled"
    | "forfeit";
  /** Null when the published version has no slot for it yet (a makeup). */
  startsAt: Date | null;
  endsAt: Date | null;
  /** The slot was called off, as in a rain-out. */
  slotCancelled: boolean;
  field: string | null;
  venue: {
    name: string;
    slug: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  teamA: PublicTeam;
  teamB: PublicTeam;
  scoreA: number | null;
  scoreB: number | null;
  /** The team_season that forfeited. */
  forfeitBy: string | null;
};

/** Called off, for whatever reason: shown struck through, never as a result. */
export function isCalledOff(g: PublicGame): boolean {
  return (
    g.status === "cancelled" || g.status === "postponed" || g.slotCancelled
  );
}

/** "Cancelled", "Postponed", "Rained out", "Final", "Forfeit", "Live" or null. */
export function statusLabel(g: PublicGame): string | null {
  if (g.status === "cancelled") return "Cancelled";
  if (g.status === "postponed") return "Postponed";
  if (g.slotCancelled) return "Rained out";
  if (g.status === "final") return "Final";
  if (g.status === "forfeit") return "Forfeit";
  if (g.status === "in_progress") return "Live";
  return null;
}

/** Has a result to show: a final score or a forfeit. */
export function hasResult(g: PublicGame): boolean {
  return (
    (g.status === "final" && g.scoreA !== null && g.scoreB !== null) ||
    (g.status === "forfeit" && g.forfeitBy !== null)
  );
}

/** "Sluggers 5, Kickers 3" or "Kickers win by forfeit"; null without a result. */
export function resultLine(g: PublicGame): string | null {
  if (!hasResult(g)) return null;
  if (g.status === "forfeit") {
    const winner = g.forfeitBy === g.teamA.id ? g.teamB : g.teamA;
    return `${winner.name} win by forfeit`;
  }
  const a = { name: g.teamA.name, runs: g.scoreA as number };
  const b = { name: g.teamB.name, runs: g.scoreB as number };
  const [first, second] = a.runs >= b.runs ? [a, b] : [b, a];
  return `${first.name} ${first.runs}, ${second.name} ${second.runs}`;
}

export type Outcome = "W" | "L" | "T";

/** The result from one team's side, or null when there is none yet. */
export function outcomeFor(g: PublicGame, teamId: string): Outcome | null {
  if (!hasResult(g)) return null;
  const isA = g.teamA.id === teamId;
  if (g.status === "forfeit") return g.forfeitBy === teamId ? "L" : "W";
  const mine = (isA ? g.scoreA : g.scoreB) as number;
  const theirs = (isA ? g.scoreB : g.scoreA) as number;
  return mine > theirs ? "W" : mine < theirs ? "L" : "T";
}

/** The other team, from one team's side. */
export function opponentOf(g: PublicGame, teamId: string): PublicTeam {
  return g.teamA.id === teamId ? g.teamB : g.teamA;
}

/** The next game still to play, or null. Called-off games do not count. */
export function nextGame(games: PublicGame[], now: Date): PublicGame | null {
  return (
    games
      .filter(
        (g) =>
          g.startsAt !== null &&
          g.endsAt !== null &&
          g.endsAt > now &&
          !hasResult(g) &&
          !isCalledOff(g),
      )
      .sort(
        (x, y) =>
          (x.startsAt as Date).getTime() - (y.startsAt as Date).getTime(),
      )[0] ?? null
  );
}

/** YYYY-MM-DD of an instant in a time zone. */
export function localDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export type GameDay = { day: string; games: PublicGame[] };

/**
 * Placed games grouped by local date in the league's time zone, in date
 * order, each day in kickoff order. Unplaced games are left out.
 */
export function groupByDay(games: PublicGame[], timeZone: string): GameDay[] {
  const days = new Map<string, PublicGame[]>();
  const placed = games
    .filter((g) => g.startsAt !== null)
    .sort(
      (x, y) =>
        (x.startsAt as Date).getTime() - (y.startsAt as Date).getTime() ||
        (x.field ?? "").localeCompare(y.field ?? ""),
    );
  for (const g of placed) {
    const day = localDay(g.startsAt as Date, timeZone);
    days.set(day, [...(days.get(day) ?? []), g]);
  }
  return [...days].map(([day, list]) => ({ day, games: list }));
}

/** "Field 2, Riverside Park, 1 Park Ave" with whatever parts are known. */
export function placeLine(g: PublicGame): string | null {
  const parts = [g.field, g.venue?.name, g.venue?.address].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length ? parts.join(", ") : null;
}
