import type { Schedule, ScheduledGame, SchedulerInput, Slot } from "./types";

export type HardRule =
  "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7" | "H8" | "H9" | "H10";

export type Violation = {
  rule: HardRule;
  message: string;
  /** The games involved, sorted. */
  gameKeys: string[];
};

type Placed = { game: ScheduledGame; slot: Slot };
type Appearance = Placed & { team: string; opponent: string };

const RULE_ORDER: HardRule[] = [
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "H7",
  "H8",
  "H9",
  "H10",
];

/**
 * Stage D (scheduling-algorithm.md, section 4): lists every hard-constraint
 * violation in a schedule.
 *
 * It re-derives each rule from the output alone and imports nothing from
 * the stages that build a schedule, so a bug there cannot hide itself here.
 * It is also the oracle for the property tests and the check behind manual
 * edits.
 */
export function validate(
  input: SchedulerInput,
  schedule: Schedule,
): Violation[] {
  const violations: Violation[] = [];
  const report = (rule: HardRule, message: string, keys: string[]) =>
    violations.push({ rule, message, gameKeys: [...new Set(keys)].sort() });

  // H1: each game once; H3: its slot exists.
  for (const [key, copies] of Map.groupBy(schedule.games, (g) => g.key)) {
    if (copies.length > 1)
      report("H1", `Game ${key} is listed ${copies.length} times.`, [key]);
  }
  const slotsById = new Map(input.slots.map((slot) => [slot.id, slot]));
  const placed: Placed[] = [];
  for (const game of schedule.games) {
    if (game.slotId === null) continue;
    const slot = slotsById.get(game.slotId);
    if (slot) placed.push({ game, slot });
    else
      report(
        "H3",
        `Game ${game.key} is in slot ${game.slotId}, which does not exist.`,
        [game.key],
      );
  }

  // H1: a slot holds at most one game.
  for (const [slotId, inSlot] of Map.groupBy(placed, (p) => p.slot.id)) {
    if (inSlot.length > 1)
      report(
        "H1",
        `Slot ${slotId} holds ${inSlot.length} games.`,
        inSlot.map((p) => p.game.key),
      );
  }

  const appearances: Appearance[] = placed.flatMap((p) => [
    { ...p, team: p.game.teamA, opponent: p.game.teamB },
    { ...p, team: p.game.teamB, opponent: p.game.teamA },
  ]);

  // H2: a team is never in two games at once.
  const atOnce = Map.groupBy(
    appearances,
    (a) => `${a.team}\u0000${a.slot.date}\u0000${a.slot.timeIndex}`,
  );
  for (const same of atOnce.values()) {
    const [first] = same;
    if (first && same.length > 1)
      report(
        "H2",
        `Team ${first.team} plays ${same.length} games at once on ${first.slot.date} (time slot ${first.slot.timeIndex + 1}).`,
        same.map((a) => a.game.key),
      );
  }

  // H4: never in a slot the team marked unavailable.
  const unavailable = input.constraints.filter((c) => c.kind === "unavailable");
  for (const a of appearances) {
    const blocked = unavailable.some(
      (c) =>
        c.teamId === a.team &&
        (c.date === undefined || c.date === a.slot.date) &&
        (c.timeIndex === undefined || c.timeIndex === a.slot.timeIndex),
    );
    if (blocked)
      report(
        "H4",
        `Team ${a.team} is unavailable on ${a.slot.date} (time slot ${a.slot.timeIndex + 1}) but plays ${a.game.key} then.`,
        [a.game.key],
      );
  }

  checkRounds(input, schedule, report);

  // H6: games per team per day; H8: doubleheader opponents differ.
  const byDay = Map.groupBy(
    appearances,
    (a) => `${a.team}\u0000${a.slot.date}`,
  );
  for (const day of byDay.values()) {
    const first = day[0] as Appearance;
    const regular = day.filter((a) => a.slot.kind !== "makeup_reserve");
    if (regular.length > input.gamesPerTeamPerDay || day.length > 2)
      report(
        "H6",
        `Team ${first.team} plays ${day.length} games on ${first.slot.date}; the limit is ${input.gamesPerTeamPerDay}, or 2 with makeups.`,
        day.map((a) => a.game.key),
      );
    for (const [opponent, games] of Map.groupBy(day, (a) => a.opponent)) {
      if (games.length > 1 && first.team < opponent)
        report(
          "H8",
          `Teams ${first.team} and ${opponent} play each other twice on ${first.slot.date}.`,
          games.map((a) => a.game.key),
        );
    }
  }

  // H9: locked games stay put.
  const gamesByKey = new Map(schedule.games.map((g) => [g.key, g]));
  for (const lock of input.locked) {
    const game = gamesByKey.get(lock.gameKey);
    if (!game)
      report("H9", `Locked game ${lock.gameKey} is missing.`, [lock.gameKey]);
    else if (game.slotId !== lock.slotId)
      report(
        "H9",
        `Locked game ${lock.gameKey} moved from ${lock.slotId} to ${game.slotId ?? "no slot"}.`,
        [lock.gameKey],
      );
  }

  checkReserve(input, placed, report);

  return violations.sort(
    (a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule),
  );
}

type Report = (rule: HardRule, message: string, keys: string[]) => void;

/** H5 (round-robin order) and H7 (every team plays once or has the bye). */
function checkRounds(
  input: SchedulerInput,
  schedule: Schedule,
  report: Report,
) {
  const rounds = [
    ...new Set([
      ...schedule.games.map((g) => g.round),
      ...schedule.byes.map((b) => b.round),
    ]),
  ].sort((a, b) => a - b);
  const pools = Map.groupBy(input.teams, (t) => t.divisionId ?? "");

  for (const pool of pools.values()) {
    const members = pool.map((t) => t.id).sort();
    if (members.length < 2) continue;
    const inPool = new Set(members);
    const games = schedule.games.filter(
      (g) => inPool.has(g.teamA) && inPool.has(g.teamB),
    );
    const byes = schedule.byes.filter((b) => inPool.has(b.teamId));
    const odd = members.length % 2 === 1;
    const pairKey = (a: string, b: string) =>
      a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    const meetings = new Map<string, number>();
    const byeCounts = new Map<string, number>();
    let orderBroken = false;

    for (const round of rounds) {
      const roundGames = games.filter((g) => g.round === round);
      const roundByes = byes.filter((b) => b.round === round);
      if (roundGames.length === 0 && roundByes.length === 0) continue;

      const wanted = odd ? 1 : 0;
      if (roundByes.length !== wanted)
        report(
          "H7",
          `Round ${round} has ${roundByes.length} byes; it should have ${wanted}.`,
          [],
        );
      for (const team of members) {
        const plays = roundGames.filter(
          (g) => g.teamA === team || g.teamB === team,
        );
        const listed =
          plays.length + roundByes.filter((b) => b.teamId === team).length;
        if (listed !== 1)
          report(
            "H7",
            listed === 0
              ? `In round ${round}, team ${team} neither plays nor has a bye.`
              : `In round ${round}, team ${team} is listed ${listed} times.`,
            plays.map((g) => g.key),
          );
      }
      for (const bye of roundByes)
        byeCounts.set(bye.teamId, (byeCounts.get(bye.teamId) ?? 0) + 1);

      for (const g of roundGames) {
        const key = pairKey(g.teamA, g.teamB);
        meetings.set(key, (meetings.get(key) ?? 0) + 1);
      }
      if (orderBroken) continue;
      let most = 0;
      let mostPair = "";
      let fewest = Infinity;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          const key = pairKey(members[i] as string, members[j] as string);
          const count = meetings.get(key) ?? 0;
          if (count > most) [most, mostPair] = [count, key];
          fewest = Math.min(fewest, count);
        }
      if (most - fewest > 1) {
        orderBroken = true;
        const [a, b] = mostPair.split("\u0000") as [string, string];
        report(
          "H5",
          `After round ${round}, teams ${a} and ${b} have met ${most} times while another pair has met ${fewest}.`,
          games
            .filter(
              (g) => g.round <= round && pairKey(g.teamA, g.teamB) === mostPair,
            )
            .map((g) => g.key),
        );
      }
    }

    if (odd) {
      const counts = members.map((t) => byeCounts.get(t) ?? 0);
      const spread = Math.max(...counts) - Math.min(...counts);
      if (spread > 1)
        report(
          "H7",
          `Bye counts differ by ${spread} between teams; they should differ by at most 1.`,
          [],
        );
    }
  }
}

/**
 * H10: each date keeps `reservePerDay` regular slots empty, when it has
 * that many to spare. A round's home date is the date holding most of its
 * games (the earliest on a tie); games played away from their round's home
 * date, such as makeups or manual moves, count against the reserve.
 */
function checkReserve(input: SchedulerInput, placed: Placed[], report: Report) {
  const homeDate = new Map<number, string>();
  for (const [round, games] of Map.groupBy(placed, (p) => p.game.round)) {
    const perDate = Map.groupBy(games, (p) => p.slot.date);
    const [best] = [...perDate].sort(
      ([dateA, a], [dateB, b]) =>
        b.length - a.length || dateA.localeCompare(dateB),
    ) as [[string, Placed[]]];
    homeDate.set(round, best[0]);
  }

  const regularSlots = Map.groupBy(
    input.slots.filter((s) => s.kind === "regular"),
    (s) => s.date,
  );
  const regularPlaced = placed.filter((p) => p.slot.kind === "regular");
  for (const [date, slots] of [...regularSlots].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const onDate = regularPlaced.filter((p) => p.slot.date === date);
    const away = onDate.filter((p) => homeDate.get(p.game.round) !== date);
    const spare = slots.length - (onDate.length - away.length);
    const required = Math.min(input.reservePerDay, Math.max(0, spare));
    const empty = slots.length - new Set(onDate.map((p) => p.slot.id)).size;
    if (empty < required)
      report(
        "H10",
        `${date} keeps ${empty} empty slot${empty === 1 ? "" : "s"} for makeups; it should keep ${required}.`,
        away.map((p) => p.game.key),
      );
  }
}
