import { and, asc, eq, inArray, isNotNull, min, sql } from "drizzle-orm";
import { checkInReferee } from "@/db/queries/command-center";
import { nextGameDayStart } from "@/db/queries/demo";
import { queuePaymentReminders } from "@/db/queries/payment-reminders";
import {
  checkRain,
  gameDaysDue,
  queueRainAlerts,
} from "@/db/queries/rain-alerts";
import type { Db } from "@/db/queries/schedule";
import { queueScoreReminders } from "@/db/queries/score-reminders";
import { game, gamePeriod, slot } from "@/db/schema/game";
import { season } from "@/db/schema/season";
import type { GameId } from "@/domain/ids";
import { fixtureForecast } from "@/services/weather-fixture";
import { PERSONA_IDS } from "./demo-personas";

const MINUTE = 60_000;
/** The live game started this long ago: a few innings in. */
const STARTED_AGO = 40 * MINUTE;
/** The rain alert job runs the evening before a game day. */
const ALERT_LEAD = 20 * 60 * MINUTE;

type Line = readonly (readonly [number, number])[];

/**
 * Runs per half-inning for the live games, one line each: the top half is
 * the team that kicks first. Three and a half innings in: 3 to 1, 2 to 4
 * and 2 to 3.
 */
const LINES: readonly Line[] = [
  [
    [1, 0],
    [0, 1],
    [2, 0],
  ],
  [
    [0, 0],
    [2, 1],
    [0, 3],
  ],
  [
    [1, 1],
    [0, 0],
    [1, 2],
  ],
];
const TOP_OF_FOURTH = 0;

export type LiveDemo = {
  liveGameId: GameId | null;
  rainWatchFrom: Date | null;
  queued: number;
};

/**
 * Makes the freshly seeded demo league look like a game night in progress
 * (docs/demo.md), after `demo:reset` has seeded it:
 *
 * 1. The next round still to play moves to today, so its first games
 *    started 40 minutes ago, and they are live: the team that kicks first
 *    is set, three and a half innings are entered by the demo ref (who
 *    referees that round and is checked in at the field), and the games
 *    are in progress. The round's later games haven't started.
 * 2. The league's own jobs run as they would have: the rain alert for the
 *    next game day (the weather fixture puts showers there), and any payment
 *    and missing-score reminders that are due. They wait in the outbox, for
 *    the "Demo mail" page.
 *
 * Only ever run on the demo database (scripts/demo-live.ts checks).
 */
export async function liveDemo(db: Db, now: Date): Promise<LiveDemo> {
  const liveGameId = await startLiveRound(db, now);
  const rainWatchFrom = await nextGameDayStart(db, now);
  let queued = 0;
  if (rainWatchFrom) {
    const alertAt = new Date(rainWatchFrom.getTime() - ALERT_LEAD);
    const checks = await checkRain(await gameDaysDue(db, alertAt), () =>
      Promise.resolve(fixtureForecast(alertAt, rainWatchFrom)),
    );
    queued += await queueRainAlerts(db, checks, now);
  }
  queued += await queuePaymentReminders(db, now);
  queued += await queueScoreReminders(db, now);
  return { liveGameId, rainWatchFrom, queued };
}

/**
 * Moves the next round to today and starts its first games. A game night
 * already under way is left as it is, so running this twice is harmless.
 */
async function startLiveRound(db: Db, now: Date): Promise<GameId | null> {
  const [live] = await db
    .select({ id: game.id })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(
      and(eq(season.status, "in_progress"), eq(game.status, "in_progress")),
    )
    .orderBy(asc(slot.startsAt), asc(game.id))
    .limit(1);
  if (live) return live.id;

  const [next] = await db
    .select({ seasonId: game.seasonId, roundNo: min(game.roundNo) })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .where(
      and(
        eq(season.status, "in_progress"),
        eq(game.status, "scheduled"),
        isNotNull(game.slotId),
        isNotNull(game.roundNo),
      ),
    )
    .groupBy(game.seasonId)
    .orderBy(asc(min(game.roundNo)))
    .limit(1);
  if (!next || next.roundNo === null) return null;

  const round = await db
    .select({
      id: game.id,
      teamAId: game.teamAId,
      slotId: slot.id,
      startsAt: slot.startsAt,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(
      and(eq(game.seasonId, next.seasonId), eq(game.roundNo, next.roundNo)),
    )
    .orderBy(asc(slot.startsAt), asc(game.id));
  const first = round[0];
  if (!first) return null;

  // Whole minutes, five at a time, so the times read like a schedule.
  const target =
    Math.floor((now.getTime() - STARTED_AGO) / (5 * MINUTE)) * 5 * MINUTE;
  const shift = `${target - first.startsAt.getTime()} milliseconds`;
  await db
    .update(slot)
    .set({
      startsAt: sql`${slot.startsAt} + ${shift}::interval`,
      endsAt: sql`${slot.endsAt} + ${shift}::interval`,
    })
    .where(
      inArray(
        slot.id,
        round.map((g) => g.slotId),
      ),
    );

  // Every game in the round's first time slot is under way, each with its
  // own score; later ones haven't started.
  const playing = round.filter(
    (g) => g.startsAt.getTime() === first.startsAt.getTime(),
  );
  for (const [n, g] of playing.entries()) {
    await db
      .update(game)
      .set({ status: "in_progress", kicksFirst: g.teamAId })
      .where(eq(game.id, g.id));
    await db
      .insert(gamePeriod)
      .values(halves(LINES[n % LINES.length] ?? [], g.id, target));
  }
  // The demo ref, who referees the round, is at the field.
  await checkInReferee(db, {
    gameId: first.id,
    userId: PERSONA_IDS.ref,
    now: new Date(target - 10 * MINUTE),
  });
  return first.id;
}

/** A game's half-innings so far, entered by the demo ref every five minutes. */
function halves(line: Line, gameId: GameId, startedAt: number) {
  return [
    ...line.flatMap(([top, bottom], i) => [
      { periodNo: i + 1, half: "top" as const, runs: top },
      { periodNo: i + 1, half: "bottom" as const, runs: bottom },
    ]),
    { periodNo: line.length + 1, half: "top" as const, runs: TOP_OF_FOURTH },
  ].map((p, i) => ({
    ...p,
    gameId,
    enteredBy: PERSONA_IDS.ref,
    enteredAt: new Date(startedAt + (i + 1) * 5 * MINUTE),
  }));
}
