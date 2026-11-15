import { and, asc, eq, gte, inArray, like, ne } from "drizzle-orm";
import {
  changesFor,
  type DayGame,
  type DayStatus,
  type StatusInput,
  watchNews,
} from "@/domain/gameday/status";
import type {
  GameDayStatusId,
  GameId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import type {
  GameDayChangePayload,
  GameDayDecidePayload,
  GameDayWatchPayload,
} from "@/emails/game-day";
import { gameDayStatus, gameDayStatusGame } from "../schema/game-day";
import { leagueMember } from "../schema/league";
import { message } from "../schema/message";
import { season as seasonTable } from "../schema/season";
import { registration, rosterMembership } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { publishedSchedule } from "./public-schedule";
import type { Db } from "./schedule";

/**
 * Game-day status (issue #383): one row per season and date, with the games
 * a Delayed or Off touches. Saving a status audits it, tells the players of
 * the games it changes (and, for a weather watch, the players who asked),
 * and times the admins' reminder for a decision time. Nothing here cancels
 * a game: calling games off for good goes through the rain-out flow.
 */

export type DayGameWithTeams = DayGame & {
  teamSeasonIds: readonly [string, string];
};

/**
 * The games still on a season's published schedule on a date (YYYY-MM-DD,
 * league time), in start order: placed, not in a called-off slot, and not
 * finished or cancelled.
 */
export async function dayGames(
  db: Db,
  seasonId: SeasonId,
  date: string,
  timeZone: string,
): Promise<DayGameWithTeams[]> {
  const games = await publishedSchedule(db, seasonId);
  return games
    .filter(
      (g): g is typeof g & { startsAt: Date } =>
        g.startsAt !== null &&
        !g.slotCancelled &&
        (g.status === "scheduled" || g.status === "in_progress") &&
        localDay(g.startsAt, timeZone) === date,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((g) => ({
      id: g.id,
      startsAt: g.startsAt,
      teams: `${g.teamA.name} vs ${g.teamB.name}`,
      teamSeasonIds: [g.teamA.id, g.teamB.id] as const,
    }));
}

export type SavedStatus = DayStatus & { id: GameDayStatusId; date: string };

/** A season's statuses from a date on (YYYY-MM-DD), by date. */
export async function statusesFrom(
  db: Db,
  seasonId: SeasonId,
  fromDate: string,
): Promise<Map<string, SavedStatus>> {
  const rows = await db
    .select()
    .from(gameDayStatus)
    .where(
      and(
        eq(gameDayStatus.seasonId, seasonId),
        gte(gameDayStatus.date, fromDate),
      ),
    )
    .orderBy(asc(gameDayStatus.date));
  if (rows.length === 0) return new Map();
  const games = await db
    .select()
    .from(gameDayStatusGame)
    .where(
      inArray(
        gameDayStatusGame.statusId,
        rows.map((r) => r.id),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.date,
      {
        id: r.id,
        date: r.date,
        state: r.state,
        decideBy: r.decideBy,
        reason: r.reason,
        setAt: r.setAt,
        games: new Map(
          games
            .filter((g) => g.statusId === r.id)
            .map((g) => [g.gameId, g.newStartsAt]),
        ),
      },
    ]),
  );
}

/** The players on the active rosters of the given team-season entries. */
async function rosterOf(
  db: Db,
  teamSeasonIds: readonly string[],
): Promise<{ teamSeasonId: string; userId: UserId }[]> {
  if (teamSeasonIds.length === 0) return [];
  return db
    .select({
      teamSeasonId: rosterMembership.teamSeasonId,
      userId: registration.userId,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        inArray(
          rosterMembership.teamSeasonId,
          // The public schedule names each team by its season entry's id.
          teamSeasonIds as readonly TeamSeasonId[],
        ),
        eq(rosterMembership.status, "active"),
        ne(registration.status, "cancelled"),
        ne(registration.status, "refunded"),
      ),
    );
}

const decideKey = (statusId: string) => `game-day-decide/${statusId}/`;

export type SetResult = {
  /** Players told their game starts late, is off or is back on. */
  told: number;
  /** Players who asked for weather watches and were sent this one. */
  watchers: number;
  /** Admins who will be reminded at the decision time. */
  reminders: number;
};

/**
 * Saves a game day's status in the caller's transaction. The row is locked,
 * so two admins saving at once take turns and each change is compared with
 * the one before it: nobody hears the same news twice. Returns who was
 * told.
 */
export async function setDayStatus(
  db: Db,
  input: {
    season: { id: SeasonId; slug: string; name: string; timeZone: string };
    date: string;
    status: StatusInput;
    games: readonly DayGameWithTeams[];
    actorId: UserId;
    now: Date;
  },
): Promise<SetResult> {
  const { season, date, status, games, now } = input;
  const created = await db
    .insert(gameDayStatus)
    .values({ seasonId: season.id, date, state: "on", setAt: now })
    .onConflictDoNothing()
    .returning({ id: gameDayStatus.id });
  const [row] = await db
    .select()
    .from(gameDayStatus)
    .where(
      and(eq(gameDayStatus.seasonId, season.id), eq(gameDayStatus.date, date)),
    )
    .for("update");
  if (!row) throw new Error("The game-day status row is missing");
  const before: Pick<DayStatus, "state" | "decideBy" | "games"> | null =
    created.length > 0
      ? null
      : {
          state: row.state,
          decideBy: row.decideBy,
          games: new Map(
            (
              await db
                .select()
                .from(gameDayStatusGame)
                .where(eq(gameDayStatusGame.statusId, row.id))
            ).map((g) => [g.gameId, g.newStartsAt]),
          ),
        };

  await db
    .update(gameDayStatus)
    .set({
      state: status.state,
      decideBy: status.decideBy,
      reason: status.reason,
      setBy: input.actorId,
      setAt: now,
    })
    .where(eq(gameDayStatus.id, row.id));
  await db
    .delete(gameDayStatusGame)
    .where(eq(gameDayStatusGame.statusId, row.id));
  if (status.games.size > 0)
    await db.insert(gameDayStatusGame).values(
      [...status.games].map(([gameId, newStartsAt]) => ({
        statusId: row.id,
        gameId: gameId as GameId,
        newStartsAt,
      })),
    );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "game_day.status",
    entityType: "season",
    entityId: season.id,
    before: before
      ? { date, state: before.state, games: before.games.size }
      : { date, state: null },
    after: {
      date,
      state: status.state,
      decideBy: status.decideBy?.toISOString() ?? null,
      reason: status.reason,
      games: status.games.size,
    },
  });

  // The admins' reminder for the old decision time no longer applies.
  await db
    .update(message)
    .set({ status: "suppressed", suppressReason: "superseded" })
    .where(
      and(
        like(message.dedupeKey, `${decideKey(row.id)}%`),
        eq(message.status, "queued"),
      ),
    );

  const day = shortDay(games[0]?.startsAt ?? now, season.timeZone);
  const byId = new Map(games.map((g) => [g.id, g]));
  const changes = changesFor(
    before,
    status,
    games.map((g) => g.id),
  );
  const changedTeams = changes.flatMap((c) => [
    ...(byId.get(c.gameId)?.teamSeasonIds ?? []),
  ]);
  const watching = watchNews(before, status);
  const roster = await rosterOf(
    db,
    watching ? games.flatMap((g) => [...g.teamSeasonIds]) : changedTeams,
  );
  const stamp = now.getTime();
  const messages: OutboxMessage[] = [];

  for (const c of changes) {
    const g = byId.get(c.gameId);
    if (!g) continue;
    const payload = {
      seasonName: season.name,
      gameId: g.id,
      teams: g.teams,
      day,
      was: kickoff(g.startsAt, season.timeZone),
      kind: c.kind,
      newStart:
        c.kind === "delayed" ? kickoff(c.newStartsAt, season.timeZone) : null,
      reason: status.reason,
    } satisfies GameDayChangePayload;
    for (const r of roster)
      if (g.teamSeasonIds.includes(r.teamSeasonId))
        messages.push({
          userId: r.userId,
          topic: "rainout",
          template: "game_day_change",
          payload,
          dedupeKey: `game-day/${g.id}/${c.kind}/${stamp}/${r.userId}`,
          sendAfter: now,
        });
  }
  const told = new Set(messages.map((m) => m.userId)).size;

  let watchers = 0;
  if (watching && status.decideBy) {
    const decideBy = kickoff(status.decideBy, season.timeZone);
    const seen = new Set<string>();
    for (const g of games) {
      const payload = {
        seasonName: season.name,
        gameId: g.id,
        teams: g.teams,
        day,
        decideBy,
        reason: status.reason,
      } satisfies GameDayWatchPayload;
      for (const r of roster) {
        if (!g.teamSeasonIds.includes(r.teamSeasonId) || seen.has(r.userId))
          continue;
        seen.add(r.userId);
        messages.push({
          userId: r.userId,
          // Off unless the player turned weather watches on.
          topic: "game_day_watch",
          template: "game_day_watch",
          payload,
          dedupeKey: `game-day-watch/${row.id}/${status.decideBy.toISOString()}/${r.userId}`,
          sendAfter: now,
        });
      }
    }
    watchers = seen.size;
  }

  let reminders = 0;
  if (status.state === "watching" && status.decideBy) {
    // The admins and owners of the season's league (ADR 0048).
    const admins = await db
      .select({ id: leagueMember.userId })
      .from(seasonTable)
      .innerJoin(leagueMember, eq(leagueMember.leagueId, seasonTable.leagueId))
      .where(
        and(
          eq(seasonTable.id, season.id),
          inArray(leagueMember.role, ["admin", "owner"]),
        ),
      );
    const payload = {
      seasonName: season.name,
      seasonSlug: season.slug,
      date,
      day,
      decideBy: kickoff(status.decideBy, season.timeZone),
    } satisfies GameDayDecidePayload;
    for (const a of admins)
      messages.push({
        userId: a.id,
        topic: "rainout",
        template: "game_day_decide",
        payload,
        dedupeKey: `${decideKey(row.id)}${status.decideBy.toISOString()}/${stamp}/${a.id}`,
        // Sent when the decision time comes, unless a newer status
        // suppresses it first.
        sendAfter: status.decideBy,
      });
    reminders = admins.length;
  }
  await enqueueMessages(db, messages);
  return { told, watchers, reminders };
}
