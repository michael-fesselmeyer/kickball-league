import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  type BodyArea,
  type CareLevel,
  certificateFor,
  injuryCutoff,
  type InjuryExport,
  type NewInjury,
  REMOVED_TEXT,
} from "@/domain/discipline/injury";
import type { GameId, IncidentId, LeagueId, UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import {
  incident,
  incidentNote,
  injuryReport,
  injuryWitness,
} from "../schema/discipline";
import { game, slot } from "../schema/game";
import { league, leagueMember } from "../schema/league";
import { insuranceCertificate } from "../schema/books";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Injury reports (docs/adr/0064-injury-reports.md): the injury part of an
 * incident, who may read it, the carrier's export and the removal of the
 * details. Nothing here puts health details in an audit row or a message:
 * both say only that something happened and where to look.
 */

/** "2026-09-15" on the league's wall clock. */
const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);

/** Writes the injury and its witnesses for a report just filed. */
export async function saveInjury(
  db: Db,
  incidentId: IncidentId,
  injury: NewInjury,
): Promise<void> {
  await db.insert(injuryReport).values({
    incidentId,
    hurtUserId: injury.hurt as UserId,
    bodyArea: injury.bodyArea,
    care: injury.care,
  });
  if (injury.witnesses.length > 0)
    await db.insert(injuryWitness).values(
      injury.witnesses.map((w) => ({
        incidentId,
        userId: w as UserId,
      })),
    );
}

/** A league's owners and admins, the only people who read injury reports. */
async function reviewersOf(db: Db, leagueId: LeagueId): Promise<UserId[]> {
  const rows = await db
    .select({ id: leagueMember.userId })
    .from(leagueMember)
    .where(
      and(
        eq(leagueMember.leagueId, leagueId),
        inArray(leagueMember.role, ["owner", "admin"]),
      ),
    )
    .orderBy(asc(leagueMember.userId));
  return rows.map((r) => r.id);
}

const teamA = alias(teamSeason, "injury_team_a");
const teamB = alias(teamSeason, "injury_team_b");
const nameA = alias(team, "injury_name_a");
const nameB = alias(team, "injury_name_b");

/** The game's league, and how to name the game in a message. */
async function gameFacts(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      leagueId: season.leagueId,
      leagueName: league.name,
      timeZone: league.timezone,
      teamA: nameA.name,
      teamB: nameB.name,
      startsAt: slot.startsAt,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(teamA, eq(game.teamAId, teamA.id))
    .innerJoin(nameA, eq(teamA.teamId, nameA.id))
    .innerJoin(teamB, eq(game.teamBId, teamB.id))
    .innerJoin(nameB, eq(teamB.teamId, nameB.id))
    .leftJoin(slot, eq(game.slotId, slot.id))
    .where(eq(game.id, gameId));
  return found ?? null;
}

/**
 * Tells the league's owners and admins that a report was filed for a game,
 * and nothing more: not that it is an injury, not who or what. The message
 * links to the report, which only they can open. The person who filed it
 * isn't told. Returns how many were messaged.
 */
export async function queueFiledNotices(
  db: Db,
  input: {
    incidentId: IncidentId;
    gameId: GameId;
    filedBy: UserId;
    now: Date;
  },
): Promise<number> {
  const facts = await gameFacts(db, input.gameId);
  if (!facts) return 0;
  const reviewers = (await reviewersOf(db, facts.leagueId)).filter(
    (id) => id !== input.filedBy,
  );
  if (reviewers.length === 0) return 0;
  return enqueueMessages(
    db,
    reviewers.map((userId) => ({
      userId,
      topic: "operations" as const,
      template: "incident_filed" as const,
      payload: {
        incidentId: input.incidentId,
        matchup: `${facts.teamA} vs ${facts.teamB}`,
      },
      dedupeKey: `incident_filed:${input.incidentId}:${userId}`,
      sendAfter: input.now,
    })),
  );
}

export type InjuryView = {
  hurtName: string | null;
  bodyArea: BodyArea;
  care: CareLevel;
  witnesses: string[];
};

/**
 * What an owner or admin reads on an injury report, or null once its
 * details were removed. Reading is for the report page, which records the
 * view first (`recordInjuryView`).
 */
export async function injuryOf(
  db: Db,
  incidentId: IncidentId,
): Promise<InjuryView | null> {
  const [report] = await db
    .select({
      hurtName: user.name,
      bodyArea: injuryReport.bodyArea,
      care: injuryReport.care,
      hurtUserId: injuryReport.hurtUserId,
    })
    .from(injuryReport)
    .leftJoin(user, eq(injuryReport.hurtUserId, user.id))
    .where(eq(injuryReport.incidentId, incidentId));
  if (!report) return null;
  const witnesses = await db
    .select({ name: user.name })
    .from(injuryWitness)
    .innerJoin(user, eq(injuryWitness.userId, user.id))
    .where(eq(injuryWitness.incidentId, incidentId))
    .orderBy(asc(user.name));
  return {
    hurtName: report.hurtName,
    bodyArea: report.bodyArea,
    care: report.care,
    witnesses: witnesses.map((w) => w.name),
  };
}

/** Every time an owner or admin opens an injury report, for the audit log. */
export async function recordInjuryView(
  db: Db,
  input: { incidentId: IncidentId; actorId: UserId },
): Promise<void> {
  await recordAudit(db, {
    actorId: input.actorId,
    action: "injury.view",
    entityType: "incident",
    entityId: input.incidentId,
  });
}

/**
 * The carrier's copy of an injury report, with the league's insurance
 * certificate in force on the game's day (or the one that ran out last).
 * Writes the audit row in the same transaction. Null when the incident is
 * not an injury report or its details were removed.
 */
export async function exportInjury(
  db: Db,
  input: { incidentId: IncidentId; actorId: UserId },
): Promise<InjuryExport | null> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        gameId: incident.gameId,
        details: incident.details,
        reportedAt: incident.reportedAt,
        kind: incident.kind,
      })
      .from(incident)
      .where(eq(incident.id, input.incidentId));
    if (!found || found.kind !== "injury") return null;
    const view = await injuryOf(tx, input.incidentId);
    if (!view) return null;
    const facts = await gameFacts(tx, found.gameId);
    if (!facts) return null;
    const [notes, certificates] = await Promise.all([
      tx
        .select({ body: incidentNote.body, writtenAt: incidentNote.writtenAt })
        .from(incidentNote)
        .where(eq(incidentNote.incidentId, input.incidentId))
        .orderBy(asc(incidentNote.writtenAt)),
      tx
        .select({
          insurer: insuranceCertificate.insurer,
          policyNumber: insuranceCertificate.policyNumber,
          startsOn: insuranceCertificate.startsOn,
          expiresOn: insuranceCertificate.expiresOn,
        })
        .from(insuranceCertificate)
        .where(eq(insuranceCertificate.leagueId, facts.leagueId)),
    ]);
    const gameDay = facts.startsAt
      ? localDate(facts.startsAt, facts.timeZone)
      : null;
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "injury.export",
      entityType: "incident",
      entityId: input.incidentId,
    });
    return {
      leagueName: facts.leagueName,
      reportedOn: localDate(found.reportedAt, facts.timeZone),
      gameDay,
      matchup: `${facts.teamA} vs ${facts.teamB}`,
      hurt: view.hurtName,
      bodyArea: view.bodyArea,
      care: view.care,
      details: found.details,
      witnesses: view.witnesses,
      followUp: notes.map((n) => ({
        on: localDate(n.writtenAt, facts.timeZone),
        body: n.body,
      })),
      insurance: certificateFor(
        certificates,
        gameDay ?? localDate(found.reportedAt, facts.timeZone),
      ),
    };
  });
}

export type RemovalReason = "retention" | "requested";

/**
 * Removes an injury report's health details: the injury, its witnesses,
 * the follow-up notes and the text of what happened. The incident stays,
 * with its game, date and status, so the league still counts it. Writes
 * `injury.delete` (who, and why) in the same transaction. False when there
 * were no details left to remove.
 */
export async function removeInjuryDetails(
  db: Db,
  input: {
    incidentId: IncidentId;
    actorId: UserId | null;
    reason: RemovalReason;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: incident.id })
      .from(incident)
      .innerJoin(injuryReport, eq(injuryReport.incidentId, incident.id))
      .where(
        and(eq(incident.id, input.incidentId), eq(incident.kind, "injury")),
      )
      .for("update", { of: incident });
    if (!row) return false;
    await tx
      .delete(injuryWitness)
      .where(eq(injuryWitness.incidentId, input.incidentId));
    await tx
      .delete(injuryReport)
      .where(eq(injuryReport.incidentId, input.incidentId));
    await tx
      .delete(incidentNote)
      .where(eq(incidentNote.incidentId, input.incidentId));
    await tx
      .update(incident)
      .set({ details: REMOVED_TEXT })
      .where(eq(incident.id, input.incidentId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "injury.delete",
      entityType: "incident",
      entityId: input.incidentId,
      after: { reason: input.reason },
    });
    return true;
  });
}

/**
 * The retention job: removes the details of every injury report older than
 * the period. Safe to run twice; a report is removed once. Returns how many.
 */
export async function removeExpiredInjuries(
  db: Db,
  now: Date,
): Promise<number> {
  const due = await db
    .select({ id: incident.id })
    .from(incident)
    .innerJoin(injuryReport, eq(injuryReport.incidentId, incident.id))
    .where(
      and(
        eq(incident.kind, "injury"),
        lte(incident.reportedAt, injuryCutoff(now)),
      ),
    )
    .orderBy(asc(incident.reportedAt));
  let removed = 0;
  for (const { id } of due)
    if (
      await removeInjuryDetails(db, {
        incidentId: id,
        actorId: null,
        reason: "retention",
      })
    )
      removed += 1;
  return removed;
}
