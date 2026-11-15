import type { Slot } from "./types";

/** How a bracket sends teams out: after one loss, or after two. */
export type BracketFormat = "single_elimination" | "double_elimination";

/**
 * Which part of a bracket a match belongs to. `main` is the whole of a
 * single-elimination bracket and the winners' side of a double-elimination
 * one; `reset` is the "if necessary" second grand final.
 */
export type MatchStage =
  "main" | "losers" | "grand_final" | "reset" | "third_place";

/**
 * Who fills one side of a match: a seeded team, or the winner or loser of
 * an earlier match.
 */
export type BracketSide =
  | { seed: number; teamId: string }
  | { winnerOf: string }
  | { loserOf: string };

export type BracketMatch = {
  /**
   * Stable code: `r{round}m{position}` on the main side, `l{round}m{position}`
   * on the losers' side, `gf` and `gf2` for the grand final and its "if
   * necessary" game, `p3` for the third-place game.
   */
  id: string;
  stage: MatchStage;
  /** Round within its stage, 1-based; 1 for the one-game stages. */
  round: number;
  /** 1-based place in its round; a bye leaves a gap. */
  position: number;
  home: BracketSide;
  away: BracketSide;
  slotId: string | null;
  /** The game's number in the bracket, in the order games are played. */
  gameNo: number;
};

export type Bracket = { matches: BracketMatch[]; diagnostics: string[] };

export type BracketOptions = {
  format?: BracketFormat;
  /** A game between the semifinal losers (single elimination only). */
  thirdPlace?: boolean;
};

/**
 * Standard bracket order for a power-of-two size: 1, 8, 4, 5, 2, 7, 3, 6
 * for 8. Adjacent pairs meet in the first round, and the top two seeds can
 * only meet in the final.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((s) => [s, next - s]);
  }
  return order;
}

/** "Final", "Semifinals", "Quarterfinals", then "Round 1"… */
export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

/** Rounds on the losers' side of a double-elimination bracket. */
export function losersRoundCount(mainRounds: number): number {
  return Math.max(0, 2 * (mainRounds - 1));
}

/**
 * The heading for a round of a stage: "Semifinals" in a single-elimination
 * bracket, "Winners' round 2" and "Losers' final" in a double-elimination
 * one, "Grand final" and so on for the one-game stages.
 */
export function stageRoundName(
  stage: MatchStage,
  round: number,
  mainRounds: number,
  format: BracketFormat,
): string {
  switch (stage) {
    case "main":
      if (format === "single_elimination") return roundName(round, mainRounds);
      return round === mainRounds ? "Winners' final" : `Winners' round ${round}`;
    case "losers":
      return round === losersRoundCount(mainRounds)
        ? "Losers' final"
        : `Losers' round ${round}`;
    case "grand_final":
      return "Grand final";
    case "reset":
      return "If-necessary final";
    case "third_place":
      return "Third-place game";
  }
}

/** "The semifinals continue", "Losers' round 2 continues". */
function continues(name: string): string {
  if (/^(Round|Winners' round|Losers' round) /.test(name))
    return `${name} continues`;
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  return name.endsWith("s") ? `The ${lower} continue` : `The ${lower} continues`;
}

/** "Sun, Aug 8" for a calendar date such as 2027-08-08. */
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

/** The smallest power of two, at least 2, that holds `teams`. */
function sizeFor(teams: number): number {
  let size = 2;
  while (size < teams) size *= 2;
  return size;
}

type Entry = BracketSide | null;
type Draft = Omit<BracketMatch, "slotId" | "gameNo">;

/**
 * Every match of a bracket, in no particular order, before placement.
 * A pairing with one side missing is a bye: the other side goes straight
 * on. Byes only happen in the first round of the main side, and on the
 * losers' side where those missing first-round games would have sent a
 * team down.
 */
function buildMatches(
  seeds: readonly string[],
  format: BracketFormat,
  thirdPlace: boolean,
  diagnostics: string[],
): Draft[] {
  const size = sizeFor(seeds.length);
  const rounds = Math.log2(size);
  const matches: Draft[] = [];
  const meet = (
    stage: MatchStage,
    round: number,
    position: number,
    home: Entry,
    away: Entry,
    code: string,
  ): Entry => {
    if (!home) return away;
    if (!away) return home;
    matches.push({ id: code, stage, round, position, home, away });
    return { winnerOf: code };
  };

  // The main side. The better seed sits first in a pairing and always
  // exists, so a first-round bye only ever leaves the away side empty.
  let previous: Entry[] = seedOrder(size).map((seed) => {
    const teamId = seeds[seed - 1];
    return teamId === undefined ? null : { seed, teamId };
  });
  /** Each main round's losers by position; null where there was no game. */
  const losers: Entry[][] = [];
  for (let round = 1; previous.length > 1; round++) {
    const next: Entry[] = [];
    const dropped: Entry[] = [];
    for (let m = 0; m < previous.length / 2; m++) {
      const code = `r${round}m${m + 1}`;
      const winner = meet(
        "main",
        round,
        m + 1,
        previous[2 * m] ?? null,
        previous[2 * m + 1] ?? null,
        code,
      );
      next.push(winner);
      const played = matches.some((x) => x.id === code);
      dropped.push(played ? { loserOf: code } : null);
    }
    losers.push(dropped);
    previous = next;
  }
  const champion = previous[0] ?? null;

  if (format === "double_elimination") {
    // The losers' side: the first round's losers pair up; then, round by
    // round, the next main round's losers drop in to face the survivors,
    // who pair up again. Dropping in in reverse order every other round
    // keeps teams from meeting again straight away.
    let alive: Entry[] = losers[0] ?? [];
    let lround = 0;
    if (rounds > 1) {
      lround = 1;
      alive = halve(alive, lround);
      for (let wr = 2; wr <= rounds; wr++) {
        lround++;
        const drops = [...(losers[wr - 1] ?? [])];
        if (wr % 2 === 0) drops.reverse();
        const round = lround;
        alive = alive.map((survivor, i) =>
          meet(
            "losers",
            round,
            i + 1,
            drops[i] ?? null,
            survivor,
            `l${round}m${i + 1}`,
          ),
        );
        if (wr < rounds) {
          lround++;
          alive = halve(alive, lround);
        }
      }
    }
    const losersChampion = alive[0] ?? null;
    if (champion && losersChampion) {
      matches.push({
        id: "gf",
        stage: "grand_final",
        round: 1,
        position: 1,
        home: champion,
        away: losersChampion,
      });
      // Played only if the losers' side champion wins the grand final, so
      // both teams have one loss. The winners' side champion stays first.
      matches.push({
        id: "gf2",
        stage: "reset",
        round: 1,
        position: 1,
        home: { loserOf: "gf" },
        away: { winnerOf: "gf" },
      });
    }
  } else if (thirdPlace) {
    const semis = matches.filter(
      (m) => m.stage === "main" && m.round === rounds - 1,
    );
    const [first, second] = semis;
    if (first && second)
      matches.push({
        id: "p3",
        stage: "third_place",
        round: 1,
        position: 1,
        home: { loserOf: first.id },
        away: { loserOf: second.id },
      });
    else
      diagnostics.push(
        `No third-place game: with ${seeds.length} teams there are not two semifinals.`,
      );
  }
  return matches;

  function halve(entries: Entry[], round: number): Entry[] {
    const out: Entry[] = [];
    for (let i = 0; i < entries.length / 2; i++)
      out.push(
        meet(
          "losers",
          round,
          i + 1,
          entries[2 * i] ?? null,
          entries[2 * i + 1] ?? null,
          `l${round}m${i + 1}`,
        ),
      );
    return out;
  }
}

/** The match codes a side waits on. */
export function sourceCode(side: BracketSide): string | null {
  if ("winnerOf" in side) return side.winnerOf;
  if ("loserOf" in side) return side.loserOf;
  return null;
}

/** Games that decide a title: the single-elimination final, the grand finals. */
export function isTitleGame(
  m: { stage: MatchStage; round: number },
  mainRounds: number,
  format: BracketFormat,
): boolean {
  if (m.stage === "grand_final" || m.stage === "reset") return true;
  return (
    format === "single_elimination" &&
    m.stage === "main" &&
    m.round === mainRounds
  );
}

const STAGE_ORDER: Record<MatchStage, number> = {
  main: 0,
  losers: 1,
  third_place: 2,
  grand_final: 3,
  reset: 4,
};

/**
 * Waves of play: a match's wave is after every wave it waits on, and a
 * round never starts before the round before it on its side. Every wave
 * starts after the last game of the wave before, so a team's games are
 * always in order and never at the same time.
 */
function waves(matches: readonly Draft[]): Map<string, number> {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const wave = new Map<string, number>();
  const roundFloor = new Map<string, number>();
  const of = (m: Draft): number => {
    const known = wave.get(m.id);
    if (known !== undefined) return known;
    let w = 1;
    for (const side of [m.home, m.away]) {
      const code = sourceCode(side);
      const source = code ? byId.get(code) : undefined;
      if (source) w = Math.max(w, of(source) + 1);
    }
    // Keep each round of a side together, after the round before it.
    const key = `${m.stage}:${m.round - 1}`;
    w = Math.max(w, (roundFloor.get(key) ?? 0) + 1);
    wave.set(m.id, w);
    return w;
  };
  // Sides and rounds in order, so every match a match waits on, and every
  // round before its own, is settled first.
  const ordered = [...matches].sort(
    (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.round - b.round,
  );
  for (const m of ordered) {
    const w = of(m);
    const key = `${m.stage}:${m.round}`;
    roundFloor.set(key, Math.max(roundFloor.get(key) ?? 0, w));
  }
  return wave;
}

/**
 * Lays a bracket onto playoff slots (scheduling-algorithm.md, section 8).
 * Single elimination by default; double elimination adds the losers' side,
 * the grand final and its "if necessary" game. Top seeds get byes when the
 * field is not a power of two. Each wave of games starts after the last
 * game of the wave before: later on the same date, or on the next playoff
 * date with a note. Within a wave, games take the earliest free times and
 * spread across fields, and a title game comes last.
 */
export function placeBracket(
  seeds: readonly string[],
  playoffSlots: readonly Slot[],
  options: BracketOptions = {},
): Bracket {
  const diagnostics: string[] = [];
  if (seeds.length < 2) return { matches: [], diagnostics };
  const format = options.format ?? "single_elimination";
  const rounds = Math.log2(sizeFor(seeds.length));
  const drafts = buildMatches(
    seeds,
    format,
    format === "single_elimination" && (options.thirdPlace ?? false),
    diagnostics,
  );
  const wave = waves(drafts);
  const title = (m: Draft) => (isTitleGame(m, rounds, format) ? 1 : 0);
  const ordered = [...drafts].sort(
    (a, b) =>
      (wave.get(a.id) ?? 0) - (wave.get(b.id) ?? 0) ||
      title(a) - title(b) ||
      STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
      a.round - b.round ||
      a.position - b.position,
  );
  const matches: BracketMatch[] = ordered.map((m, i) => ({
    ...m,
    slotId: null,
    gameNo: i + 1,
  }));
  const name = (m: BracketMatch) =>
    stageRoundName(m.stage, m.round, rounds, format);

  const slots = [...playoffSlots].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.timeIndex - b.timeIndex ||
      a.fieldId.localeCompare(b.fieldId),
  );
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const used = new Set<string>();
  const fieldLoad = new Map<string, number>();
  // A wave may start after this point: [date, last time index used].
  let after: [string, number] = ["", -1];
  const later = (s: Slot, than: [string, number]) =>
    s.date > than[0] || (s.date === than[0] && s.timeIndex > than[1]);

  for (const w of [...new Set(matches.map((m) => wave.get(m.id) ?? 0))]) {
    const inWave = matches.filter((m) => wave.get(m.id) === w);
    let latest = after;
    for (const match of inWave) {
      const open = slots.filter((s) => !used.has(s.id) && later(s, after));
      const first = open[0];
      if (!first) {
        diagnostics.push(
          `No free slot is left for game ${match.gameNo} (${name(match).toLowerCase()}). Add a permit for playoff day or seed fewer teams.`,
        );
        continue;
      }
      // Earliest free time, then the least-used field there.
      const [slot] = open
        .filter((s) => s.date === first.date && s.timeIndex === first.timeIndex)
        .sort(
          (a, b) =>
            (fieldLoad.get(a.fieldId) ?? 0) - (fieldLoad.get(b.fieldId) ?? 0),
        ) as [Slot];
      match.slotId = slot.id;
      used.add(slot.id);
      fieldLoad.set(slot.fieldId, (fieldLoad.get(slot.fieldId) ?? 0) + 1);
      if (later(slot, latest)) latest = [slot.date, slot.timeIndex];
    }
    // A wave should finish on the date it starts on (for later waves, the
    // date the wave before ended); spilling past it is worth a note, once
    // for each round that spilled.
    const dateOf = (m: BracketMatch) =>
      m.slotId ? slotById.get(m.slotId)?.date : undefined;
    const dates = inWave.flatMap((m) => dateOf(m) ?? []).sort();
    const start = after[0] === "" ? dates[0] : after[0];
    if (start !== undefined) {
      const noted = new Set<string>();
      for (const m of inWave) {
        const date = dateOf(m);
        const round = name(m);
        if (!date || date <= start || noted.has(round)) continue;
        noted.add(round);
        const spill = inWave
          .filter((x) => name(x) === round)
          .flatMap((x) => dateOf(x) ?? [])
          .filter((d) => d > start)
          .sort()[0] as string;
        diagnostics.push(
          `${continues(round)} on ${dayLabel(spill)}, because ${dayLabel(start)} has no more room.`,
        );
      }
    }
    after = latest;
  }
  return { matches, diagnostics };
}
