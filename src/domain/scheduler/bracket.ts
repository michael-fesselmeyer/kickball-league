import type { Slot } from "./types";

/** Who fills one side of a match: a seeded team, or the winner of a match. */
export type BracketSide =
  { seed: number; teamId: string } | { winnerOf: string };

export type BracketMatch = {
  /** `r{round}m{match}`, both 1-based. */
  id: string;
  round: number;
  home: BracketSide;
  away: BracketSide;
  slotId: string | null;
};

export type Bracket = { matches: BracketMatch[]; diagnostics: string[] };

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

/**
 * Lays a single-elimination bracket onto playoff slots
 * (scheduling-algorithm.md, section 8). Top seeds get byes when the field is
 * not a power of two. Each round starts after the previous round's last
 * game: later on the same date, or on the next playoff date with a note.
 * Within a round, games take the earliest free times and spread across
 * fields.
 */
export function placeBracket(
  seeds: readonly string[],
  playoffSlots: readonly Slot[],
): Bracket {
  const diagnostics: string[] = [];
  if (seeds.length < 2) return { matches: [], diagnostics };

  let size = 2;
  while (size < seeds.length) size *= 2;
  const side = (seed: number): BracketSide | null => {
    const teamId = seeds[seed - 1];
    return teamId === undefined ? null : { seed, teamId };
  };

  // Build every round; a first-round pairing with a missing seed is a bye.
  const matches: BracketMatch[] = [];
  let previous: (BracketSide | null)[] = seedOrder(size).map(side);
  for (let round = 1; previous.length > 1; round++) {
    const winners: (BracketSide | null)[] = [];
    for (let m = 0; m < previous.length / 2; m++) {
      const home = previous[2 * m] ?? null;
      const away = previous[2 * m + 1] ?? null;
      if (!home || !away) {
        winners.push(home ?? away);
        continue;
      }
      const id = `r${round}m${m + 1}`;
      matches.push({ id, round, home, away, slotId: null });
      winners.push({ winnerOf: id });
    }
    previous = winners;
  }

  const slots = [...playoffSlots].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.timeIndex - b.timeIndex ||
      a.fieldId.localeCompare(b.fieldId),
  );
  const used = new Set<string>();
  const fieldLoad = new Map<string, number>();
  // A round may start after this point: [date, last time index used].
  let after: [string, number] = ["", -1];

  const rounds = [...new Set(matches.map((m) => m.round))];
  for (const round of rounds) {
    let latest = after;
    for (const match of matches.filter((m) => m.round === round)) {
      const open = slots.filter(
        (s) =>
          !used.has(s.id) &&
          (s.date > after[0] ||
            (s.date === after[0] && s.timeIndex > after[1])),
      );
      const first = open[0];
      if (!first) {
        diagnostics.push(
          `Not enough playoff slots: match ${match.id} has no slot.`,
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
      if (
        slot.date > latest[0] ||
        (slot.date === latest[0] && slot.timeIndex > latest[1])
      )
        latest = [slot.date, slot.timeIndex];
    }
    // A round should finish on the date it starts on (for later rounds, the
    // date the previous round ended); spilling past it is worth a note.
    const dates = matches
      .filter((m) => m.round === round)
      .flatMap((m) => slots.find((s) => s.id === m.slotId)?.date ?? [])
      .sort();
    const start = after[0] === "" ? dates[0] : after[0];
    const spill = dates.find((d) => start !== undefined && d > start);
    if (spill)
      diagnostics.push(
        `Round ${round} continues on ${spill}: ${start} has no more room.`,
      );
    after = latest;
  }
  return { matches, diagnostics };
}
