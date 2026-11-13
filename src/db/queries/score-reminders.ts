import {
  aliasedTable,
  and,
  eq,
  exists,
  gte,
  inArray,
  like,
  lte,
  not,
  or,
} from "drizzle-orm";
import type { GameId, TeamSeasonId } from "@/domain/ids";
import {
  LOOKBACK_MS,
  REFEREE_AFTER_MS,
  scoreRemindersDue,
} from "@/domain/notifications/score-reminders";
import type { ScoreReminderPayload } from "@/emails/score-reminder";
import {
  field,
  game,
  refereeAssignment,
  scoreReport,
  slot,
} from "../schema/game";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * Missing-score reminders (product-spec.md, "Scores"): a game whose slot
 * has ended with nobody reporting a score reminds its referee after 30
 * minutes and both captains after 2 hours. Admins see every such game on
 * their scores screen.
 */

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/** Played games, in open slots that ended in the window, with no score reported. */
async function gamesWithoutScores(db: Db, endedAfter: Date, endedBy: Date) {
  return db
    .select({
      id: game.id,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      teams: {
        a: teamA.name,
        b: teamB.name,
      },
      endsAt: slot.endsAt,
      startsAt: slot.startsAt,
      fieldName: field.name,
      timeZone: league.timezone,
      refereeId: refereeAssignment.userId,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(
      refereeAssignment,
      and(
        eq(refereeAssignment.gameId, game.id),
        eq(refereeAssignment.status, "accepted"),
      ),
    )
    .where(
      and(
        inArray(game.status, ["scheduled", "in_progress"]),
        eq(slot.status, "open"),
        gte(slot.endsAt, endedAfter),
        lte(slot.endsAt, endedBy),
        not(
          exists(
            db
              .select({ id: scoreReport.id })
              .from(scoreReport)
              .where(eq(scoreReport.gameId, game.id)),
          ),
        ),
      ),
    );
}

/** Captains and co-captains of the given teams, by team. */
export async function captainsOf(db: Db, teamSeasonIds: TeamSeasonId[]) {
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
        inArray(rosterMembership.teamSeasonId, teamSeasonIds),
        inArray(rosterMembership.role, ["captain", "co_captain"]),
        eq(rosterMembership.status, "active"),
      ),
    );
}

/**
 * Queues every missing-score reminder that is due. Safe to run any number
 * of times: each reminder's dedupe key names the game and the person, so
 * it is queued once. Returns how many were new.
 */
export async function queueScoreReminders(db: Db, now: Date): Promise<number> {
  const games = await gamesWithoutScores(
    db,
    new Date(now.getTime() - LOOKBACK_MS),
    new Date(now.getTime() - REFEREE_AFTER_MS),
  );
  const captains = await captainsOf(
    db,
    games.flatMap((g) => [g.teamAId, g.teamBId]),
  );
  const messages: OutboxMessage[] = [];
  for (const g of games) {
    const due = scoreRemindersDue(g.endsAt, now);
    const when = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: g.timeZone,
    }).format(g.startsAt);
    const payload = (role: ScoreReminderPayload["role"]) =>
      ({
        gameId: g.id,
        teams: `${g.teams.a} vs ${g.teams.b}`,
        when: `${when}, ${g.fieldName}`,
        role,
      }) satisfies ScoreReminderPayload;
    if (due.referee && g.refereeId)
      messages.push({
        userId: g.refereeId,
        topic: "score",
        template: "score_reminder",
        payload: payload("referee"),
        dedupeKey: `score-reminder/${g.id}/referee/${g.refereeId}`,
        sendAfter: now,
      });
    if (due.captains)
      for (const c of captains.filter(
        (c) => c.teamSeasonId === g.teamAId || c.teamSeasonId === g.teamBId,
      ))
        messages.push({
          userId: c.userId,
          topic: "score",
          template: "score_reminder",
          payload: payload("captain"),
          dedupeKey: `score-reminder/${g.id}/captain/${c.userId}`,
          sendAfter: now,
        });
  }
  return enqueueMessages(db, messages);
}

export type ReminderLog = { referee: Date | null; captains: Date | null };

/** When each game's referee and captains were first reminded, for the admin list. */
export async function scoreReminderLog(
  db: Db,
  gameIds: readonly GameId[],
): Promise<Map<GameId, ReminderLog>> {
  const log = new Map<GameId, ReminderLog>();
  if (gameIds.length === 0) return log;
  const rows = await db
    .select({ key: message.dedupeKey, at: message.createdAt })
    .from(message)
    .where(
      or(
        ...gameIds.map((id) =>
          like(message.dedupeKey, `score-reminder/${id}/%`),
        ),
      ),
    );
  for (const id of gameIds) log.set(id, { referee: null, captains: null });
  for (const r of rows) {
    const [, id, role] = r.key.split("/");
    const entry = gameIds.find((g) => g === id);
    if (!entry || (role !== "referee" && role !== "captain")) continue;
    const current = log.get(entry);
    if (!current) continue;
    const slotName = role === "referee" ? "referee" : "captains";
    const seen = current[slotName];
    if (!seen || r.at < seen) current[slotName] = r.at;
  }
  return log;
}
