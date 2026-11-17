import { and, asc, eq, inArray, isNotNull, min, ne, sql } from "drizzle-orm";
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
import {
  game,
  gamePeriod,
  gameStart,
  refereeAssignment,
  slot,
} from "@/db/schema/game";
import { refereeProfile } from "@/db/schema/referees";
import { permitWindow } from "@/db/schema/schedule";
import { league } from "@/db/schema/league";
import { season } from "@/db/schema/season";
import type {
  GameId,
  LeagueId,
  PermitWindowId,
  SlotId,
  UserId,
} from "@/domain/ids";
import { fixtureForecast } from "@/services/weather-fixture";
import { STARTED_AGO } from "./demo-evening";
import { PERSONA_IDS } from "./demo-personas";

const MINUTE = 60_000;
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
 * Makes the freshly seeded demo league (the default league; one league
 * only, ADR 0048) look like a game night in progress
 * (docs/demo.md), after `demo:reset` has seeded it:
 *
 * 1. The next round still to play moves to today, so its first games
 *    started 40 minutes before `now`, and they are live (the demo passes an
 *    evening clock, src/seed/demo-evening.ts, so the game is never at an
 *    odd hour): first pitch is recorded,
 *    the team that kicks first is set, three and a half innings are
 *    entered by the game's ref (the demo ref is checked in at the field),
 *    and the games are in progress. The round's later games haven't
 *    started. Where the demo ref has two games at one kickoff, the
 *    league's other refs take all but one, so nobody refs two at once. The permit windows the round's slots were cut from move with
 *    them, with every other slot cut from those windows, so the field time
 *    and the countdown read from today's permit.
 * 2. The league's own jobs run as they would have: the rain alert for the
 *    next game day (the weather fixture puts showers there), and any payment
 *    and missing-score reminders that are due. They wait in the outbox, for
 *    the "Demo mail" page.
 *
 * Only ever run on the demo database (scripts/demo-live.ts checks).
 */
export async function liveDemo(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<LiveDemo> {
  const liveGameId = await startLiveRound(db, leagueId, now);
  const rainWatchFrom = await nextGameDayStart(db, leagueId, now);
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
async function startLiveRound(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<GameId | null> {
  const [live] = await db
    .select({ id: game.id })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(
      and(
        eq(season.leagueId, leagueId),
        eq(season.status, "in_progress"),
        eq(game.status, "in_progress"),
      ),
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
        eq(season.leagueId, leagueId),
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

  // Whole minutes, five at a time, so the times read like a schedule, and
  // never before midnight in the league's time zone: just after midnight
  // the games start at midnight, so they are still today's.
  const [day] = await db
    .select({
      midnight: sql<string>`(date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${league.timezone}) at time zone ${league.timezone})`,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, next.seasonId));
  const midnight = day ? new Date(day.midnight).getTime() : 0;
  const target = Math.max(
    midnight,
    Math.floor((now.getTime() - STARTED_AGO) / (5 * MINUTE)) * 5 * MINUTE,
  );
  await moveRoundSlots(
    db,
    round.map((g) => g.slotId),
    target - first.startsAt.getTime(),
  );

  // Every game in the round's first time slot is under way, each with its
  // own score; later ones haven't started.
  const playing = round.filter(
    (g) => g.startsAt.getTime() === first.startsAt.getTime(),
  );
  await spreadTheRefs(db, leagueId, round);

  // Each game's own ref keeps its score; the demo ref covers a game with none.
  const refs = new Map(
    (
      await db
        .select({
          gameId: refereeAssignment.gameId,
          userId: refereeAssignment.userId,
        })
        .from(refereeAssignment)
        .where(
          and(
            inArray(
              refereeAssignment.gameId,
              playing.map((g) => g.id),
            ),
            eq(refereeAssignment.status, "accepted"),
          ),
        )
    ).map((r) => [r.gameId, r.userId]),
  );
  for (const [n, g] of playing.entries()) {
    const ref = refs.get(g.id) ?? PERSONA_IDS.ref;
    await db
      .update(game)
      .set({ status: "in_progress", kicksFirst: g.teamAId })
      .where(eq(game.id, g.id));
    await db
      .insert(gamePeriod)
      .values(halves(LINES[n % LINES.length] ?? [], g.id, target, ref));
    // First pitch went on time, tapped at the field.
    await db
      .insert(gameStart)
      .values({
        gameId: g.id,
        startedAt: new Date(target),
        recordedBy: ref,
        recordedAt: new Date(target),
      })
      .onConflictDoNothing();
  }
  // The refs of the games under way are at the field, the demo ref among
  // them, checked in for the rest of their games tonight too.
  for (const userId of new Set([PERSONA_IDS.ref, ...refs.values()]))
    await checkInReferee(db, {
      gameId: playing.find((g) => refs.get(g.id) === userId)?.id ?? first.id,
      userId,
      now: new Date(target - 10 * MINUTE),
    });
  return first.id;
}

/**
 * A ref can't be at two games at once: where the demo ref has more than one
 * game at the same kickoff tonight, they keep the first and the league's
 * other pooled refs take the rest, in a fixed order. Games with no ref, and
 * other refs' games, are left as they are.
 */
async function spreadTheRefs(
  db: Db,
  leagueId: LeagueId,
  round: readonly { id: GameId; startsAt: Date }[],
): Promise<void> {
  const others = (
    await db
      .select({ userId: refereeProfile.userId })
      .from(refereeProfile)
      .where(
        and(
          eq(refereeProfile.leagueId, leagueId),
          ne(refereeProfile.userId, PERSONA_IDS.ref),
        ),
      )
      .orderBy(asc(refereeProfile.userId))
  ).map((r) => r.userId);
  if (others.length === 0) return;
  const reeses = new Set(
    (
      await db
        .select({ gameId: refereeAssignment.gameId })
        .from(refereeAssignment)
        .where(
          and(
            inArray(
              refereeAssignment.gameId,
              round.map((g) => g.id),
            ),
            eq(refereeAssignment.userId, PERSONA_IDS.ref),
            eq(refereeAssignment.status, "accepted"),
          ),
        )
    ).map((r) => r.gameId),
  );
  const kickoffs = Map.groupBy(
    round.filter((g) => reeses.has(g.id)),
    (g) => g.startsAt.getTime(),
  );
  for (const games of kickoffs.values())
    for (const [i, g] of games.slice(1).entries()) {
      const userId = others[i];
      if (!userId) break;
      await db
        .update(refereeAssignment)
        .set({ userId })
        .where(
          and(
            eq(refereeAssignment.gameId, g.id),
            eq(refereeAssignment.userId, PERSONA_IDS.ref),
          ),
        );
    }
}

/** Far enough to clear every real slot, for the two-step move. */
const PARK = "100 years";

/**
 * Moves the round's slots by `ms`, with the permit windows they were cut
 * from and every other slot cut from those windows, so a slot stays inside
 * its window and the field time is today's. In two steps, far ahead and
 * then back, so a slot never lands on another's start on the way.
 */
async function moveRoundSlots(
  db: Db,
  slotIds: readonly SlotId[],
  ms: number,
): Promise<void> {
  const shift = `${ms} milliseconds`;
  const windows = (
    await db
      .selectDistinct({ id: slot.permitWindowId })
      .from(slot)
      .where(inArray(slot.id, [...slotIds]))
  ).flatMap((r) => (r.id ? [r.id] : [])) as PermitWindowId[];
  const moving =
    windows.length === 0
      ? inArray(slot.id, [...slotIds])
      : sql`(${inArray(slot.id, [...slotIds])} or ${inArray(slot.permitWindowId, windows)})`;
  for (const by of [
    sql`${shift}::interval + ${PARK}::interval`,
    sql`- ${PARK}::interval`,
  ])
    await db
      .update(slot)
      .set({
        startsAt: sql`${slot.startsAt} + ${by}`,
        endsAt: sql`${slot.endsAt} + ${by}`,
      })
      .where(moving);
  if (windows.length > 0)
    await db
      .update(permitWindow)
      .set({
        startsAt: sql`${permitWindow.startsAt} + ${shift}::interval`,
        endsAt: sql`${permitWindow.endsAt} + ${shift}::interval`,
      })
      .where(inArray(permitWindow.id, windows));
}

/** A game's half-innings so far, entered by its ref every five minutes. */
function halves(
  line: Line,
  gameId: GameId,
  startedAt: number,
  enteredBy: UserId,
) {
  return [
    ...line.flatMap(([top, bottom], i) => [
      { periodNo: i + 1, half: "top" as const, runs: top },
      { periodNo: i + 1, half: "bottom" as const, runs: bottom },
    ]),
    { periodNo: line.length + 1, half: "top" as const, runs: TOP_OF_FOURTH },
  ].map((p, i) => ({
    ...p,
    gameId,
    enteredBy,
    enteredAt: new Date(startedAt + (i + 1) * 5 * MINUTE),
  }));
}
