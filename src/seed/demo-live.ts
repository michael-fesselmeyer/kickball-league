import { and, asc, eq, inArray, isNotNull, min, sql } from "drizzle-orm";
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

/**
 * Runs per half-inning for the live game: the top half is the team that
 * kicks first. Three and a half innings in, 3 to 1.
 */
const LINE: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [2, 0],
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
 * 1. The next round still to play moves to today, so its first game started
 *    40 minutes ago, and that game is live: the team that kicks first is
 *    set, three and a half innings are entered (by the demo ref, who
 *    referees that round), and the game is in progress.
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

/** Moves the next round to today and starts its first game. */
async function startLiveRound(db: Db, now: Date): Promise<GameId | null> {
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

  await db
    .update(game)
    .set({ status: "in_progress", kicksFirst: first.teamAId })
    .where(eq(game.id, first.id));
  const enteredBy = PERSONA_IDS.ref;
  const enteredAt = new Date(target);
  await db.insert(gamePeriod).values(
    [
      ...LINE.flatMap(([top, bottom], i) => [
        { gameId: first.id, periodNo: i + 1, half: "top" as const, runs: top },
        {
          gameId: first.id,
          periodNo: i + 1,
          half: "bottom" as const,
          runs: bottom,
        },
      ]),
      {
        gameId: first.id,
        periodNo: LINE.length + 1,
        half: "top" as const,
        runs: TOP_OF_FOURTH,
      },
    ].map((p, i) => ({
      ...p,
      enteredBy,
      enteredAt: new Date(enteredAt.getTime() + (i + 1) * 5 * MINUTE),
    })),
  );
  return first.id;
}
