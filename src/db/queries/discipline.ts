import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  canFileFor,
  canRate,
  describeLength,
  type FileBlock,
  type IncidentKind,
  type NewIncident,
  type Rating,
  type ReporterRole,
  seasonIsOver,
  suspendedLabel,
  type SuspensionLength,
  suspensionState,
  type SuspensionState,
} from "@/domain/discipline/discipline";
import type {
  GameId,
  IncidentId,
  RegistrationId,
  SeasonId,
  SuspensionId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { user } from "../schema/auth";
import {
  incident,
  incidentNote,
  incidentPerson,
  sportsmanshipRating,
  suspension,
} from "../schema/discipline";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";
import { gameForScoring, type ScoringGame } from "./scores";

/**
 * Game-day discipline (product-spec.md, section 6, Game day): sportsmanship
 * ratings, incident reports and suspensions. The rules live in
 * src/domain/discipline/discipline.ts; every change here writes an audit row
 * in the same transaction.
 */

const shortName = (first: string | null, last: string | null, full: string) =>
  first ? (last ? `${first} ${last.charAt(0).toUpperCase()}.` : first) : full;

/** "2026-10-06" on the league's wall clock. */
const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);

// ---------------------------------------------------------------- ratings

export type RateError = "not_final" | "not_in_game";

/**
 * A captain's rating of the other team in a final game. Saving again
 * replaces the team's rating. The audit row says a rating was given, not
 * what it was.
 */
export async function rateGame(
  db: Db,
  input: {
    gameId: GameId;
    teamSeasonId: TeamSeasonId;
    ratedBy: UserId;
    rating: Rating;
    now: Date;
  },
): Promise<Result<void, RateError>> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        status: game.status,
        teamAId: game.teamAId,
        teamBId: game.teamBId,
      })
      .from(game)
      .where(eq(game.id, input.gameId));
    if (!found) return err("not_in_game");
    if (!canRate({ status: found.status, startsAt: null }))
      return err("not_final");
    const rated =
      found.teamAId === input.teamSeasonId
        ? found.teamBId
        : found.teamBId === input.teamSeasonId
          ? found.teamAId
          : null;
    if (!rated) return err("not_in_game");
    const values = {
      score: input.rating.score,
      note: input.rating.note,
      ratedBy: input.ratedBy,
      ratedAt: input.now,
    };
    await tx
      .insert(sportsmanshipRating)
      .values({
        ...values,
        gameId: input.gameId,
        teamSeasonId: input.teamSeasonId,
        ratedTeamSeasonId: rated,
      })
      .onConflictDoUpdate({
        target: [sportsmanshipRating.gameId, sportsmanshipRating.teamSeasonId],
        set: values,
      });
    await recordAudit(tx, {
      actorId: input.ratedBy,
      action: "sportsmanship.rate",
      entityType: "game",
      entityId: input.gameId,
    });
    return ok(undefined);
  });
}

/** The rating a team gave in a game, for its captains to see and change. */
export async function teamRatingFor(
  db: Db,
  gameId: GameId,
  teamSeasonId: TeamSeasonId,
): Promise<Rating | null> {
  const [found] = await db
    .select({
      score: sportsmanshipRating.score,
      note: sportsmanshipRating.note,
    })
    .from(sportsmanshipRating)
    .where(
      and(
        eq(sportsmanshipRating.gameId, gameId),
        eq(sportsmanshipRating.teamSeasonId, teamSeasonId),
      ),
    );
  return found ?? null;
}

/** The scores a team has received, oldest first, for its own average. */
export async function scoresReceived(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<number[]> {
  const rows = await db
    .select({ score: sportsmanshipRating.score })
    .from(sportsmanshipRating)
    .where(eq(sportsmanshipRating.ratedTeamSeasonId, teamSeasonId))
    .orderBy(asc(sportsmanshipRating.ratedAt), asc(sportsmanshipRating.id));
  return rows.map((r) => r.score);
}

export type TeamSportsmanship = {
  teamSeasonId: TeamSeasonId;
  name: string;
  scores: number[];
  /** Notes about the team, in alphabetical order so none can be matched to a game. */
  notes: string[];
};

/**
 * Every team in a season with the ratings it received, for admins. Never
 * says which game or team a rating came from. Two queries.
 */
export async function seasonSportsmanship(
  db: Db,
  seasonId: SeasonId,
): Promise<TeamSportsmanship[]> {
  const [teams, ratings] = await Promise.all([
    db
      .select({ id: teamSeason.id, name: team.name })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          ne(teamSeason.status, "withdrawn"),
        ),
      )
      .orderBy(asc(team.name)),
    db
      .select({
        rated: sportsmanshipRating.ratedTeamSeasonId,
        score: sportsmanshipRating.score,
        note: sportsmanshipRating.note,
      })
      .from(sportsmanshipRating)
      .innerJoin(
        teamSeason,
        eq(sportsmanshipRating.ratedTeamSeasonId, teamSeason.id),
      )
      .where(eq(teamSeason.seasonId, seasonId)),
  ]);
  return teams.map((t) => {
    const mine = ratings.filter((r) => r.rated === t.id);
    return {
      teamSeasonId: t.id,
      name: t.name,
      scores: mine.map((r) => r.score),
      notes: mine
        .flatMap((r) => (r.note ? [r.note] : []))
        .sort((a, b) => a.localeCompare(b)),
    };
  });
}

// -------------------------------------------------------------- incidents

export type GamePerson = {
  userId: UserId;
  name: string;
  teamSeasonId: TeamSeasonId;
};

/** The two teams' active players, as "First L.", for the incident form. */
export async function gamePeople(
  db: Db,
  g: Pick<ScoringGame, "teamAId" | "teamBId">,
): Promise<GamePerson[]> {
  const rows = await db
    .select({
      userId: registration.userId,
      teamSeasonId: rosterMembership.teamSeasonId,
      full: user.name,
      first: profile.firstName,
      last: profile.lastName,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(user, eq(registration.userId, user.id))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        inArray(rosterMembership.teamSeasonId, [g.teamAId, g.teamBId]),
        eq(rosterMembership.status, "active"),
      ),
    );
  return rows
    .map((r) => ({
      userId: r.userId,
      teamSeasonId: r.teamSeasonId,
      name: shortName(r.first, r.last, r.full),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type FileError = FileBlock | "not_found";

/** Files a report for a game, with the people it is about. */
export async function fileIncident(
  db: Db,
  input: {
    gameId: GameId;
    reportedBy: UserId;
    role: ReporterRole;
    incident: NewIncident;
    now: Date;
  },
): Promise<Result<IncidentId, FileError>> {
  return db.transaction(async (tx) => {
    const g = await gameForScoring(tx, input.gameId);
    if (!g) return err("not_found");
    const allowed = canFileFor(g, input.now);
    if (!allowed.ok) return allowed;
    const byId = new Map<string, GamePerson>(
      (await gamePeople(tx, g)).map((p) => [p.userId, p]),
    );
    // Only the two teams' players can be named.
    const people = input.incident.people.flatMap((id) => byId.get(id) ?? []);
    const [created] = await tx
      .insert(incident)
      .values({
        gameId: g.id,
        kind: input.incident.kind,
        details: input.incident.details,
        reportedBy: input.reportedBy,
        reporterRole: input.role,
        reportedAt: input.now,
      })
      .returning({ id: incident.id });
    if (!created) throw new Error("Expected an incident row");
    if (people.length > 0)
      await tx.insert(incidentPerson).values(
        people.map((p) => ({
          incidentId: created.id,
          userId: p.userId,
          teamSeasonId: p.teamSeasonId,
        })),
      );
    await recordAudit(tx, {
      actorId: input.reportedBy,
      action: "incident.file",
      entityType: "incident",
      entityId: created.id,
      after: {
        kind: input.incident.kind,
        people: people.length,
      },
    });
    return ok(created.id);
  });
}

export type QueueRow = {
  id: IncidentId;
  kind: IncidentKind;
  status: "open" | "resolved";
  reporterRole: ReporterRole;
  reportedAt: Date;
  gameId: GameId;
  matchup: string;
  seasonName: string;
  people: number;
};

const teamA = alias(teamSeason, "incident_team_a");
const teamB = alias(teamSeason, "incident_team_b");
const nameA = alias(team, "incident_name_a");
const nameB = alias(team, "incident_name_b");

/**
 * The review queue: every open report, oldest first, then the latest
 * resolved ones. One query.
 */
export async function incidentQueue(
  db: Db,
  resolvedLimit = 20,
): Promise<{ open: QueueRow[]; resolved: QueueRow[] }> {
  const base = () =>
    db
      .select({
        id: incident.id,
        kind: incident.kind,
        status: incident.status,
        reporterRole: incident.reporterRole,
        reportedAt: incident.reportedAt,
        gameId: incident.gameId,
        teamA: nameA.name,
        teamB: nameB.name,
        seasonName: season.name,
        people: countDistinct(incidentPerson.userId),
      })
      .from(incident)
      .innerJoin(game, eq(incident.gameId, game.id))
      .innerJoin(season, eq(game.seasonId, season.id))
      .innerJoin(teamA, eq(game.teamAId, teamA.id))
      .innerJoin(nameA, eq(teamA.teamId, nameA.id))
      .innerJoin(teamB, eq(game.teamBId, teamB.id))
      .innerJoin(nameB, eq(teamB.teamId, nameB.id))
      .leftJoin(incidentPerson, eq(incidentPerson.incidentId, incident.id))
      .groupBy(incident.id, nameA.name, nameB.name, season.name);
  const [open, resolved] = await Promise.all([
    base().where(eq(incident.status, "open")).orderBy(asc(incident.reportedAt)),
    base()
      .where(eq(incident.status, "resolved"))
      .orderBy(desc(incident.resolvedAt))
      .limit(resolvedLimit),
  ]);
  const shape = (r: (typeof open)[number]): QueueRow => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    reporterRole: r.reporterRole,
    reportedAt: r.reportedAt,
    gameId: r.gameId,
    matchup: `${r.teamA} vs ${r.teamB}`,
    seasonName: r.seasonName,
    people: r.people,
  });
  return { open: open.map(shape), resolved: resolved.map(shape) };
}

/** How many reports wait for review, for the admin dashboard. */
export async function openIncidentCount(db: Db): Promise<number> {
  const rows = await db
    .select({ id: incident.id })
    .from(incident)
    .where(eq(incident.status, "open"));
  return rows.length;
}

export type SuspensionView = {
  id: SuspensionId;
  userId: UserId;
  name: string;
  incidentId: IncidentId;
  seasonName: string;
  length: SuspensionLength;
  startsAt: Date;
  state: SuspensionState;
};

/** An incident with everything an admin reviews: people, notes, suspensions. */
export async function incidentDetail(db: Db, id: IncidentId, now: Date) {
  const [found] = await db
    .select({
      id: incident.id,
      gameId: incident.gameId,
      kind: incident.kind,
      details: incident.details,
      status: incident.status,
      reporterRole: incident.reporterRole,
      reportedAt: incident.reportedAt,
      resolvedAt: incident.resolvedAt,
      reporterName: user.name,
    })
    .from(incident)
    .leftJoin(user, eq(incident.reportedBy, user.id))
    .where(eq(incident.id, id));
  if (!found) return null;
  const author = alias(user, "note_author");
  const [g, people, notes, suspensions] = await Promise.all([
    gameForScoring(db, found.gameId),
    db
      .select({
        userId: incidentPerson.userId,
        name: user.name,
        teamName: team.name,
      })
      .from(incidentPerson)
      .innerJoin(user, eq(incidentPerson.userId, user.id))
      .leftJoin(teamSeason, eq(incidentPerson.teamSeasonId, teamSeason.id))
      .leftJoin(team, eq(teamSeason.teamId, team.id))
      .where(eq(incidentPerson.incidentId, id))
      .orderBy(asc(user.name)),
    db
      .select({
        id: incidentNote.id,
        body: incidentNote.body,
        writtenAt: incidentNote.writtenAt,
        authorName: author.name,
      })
      .from(incidentNote)
      .leftJoin(author, eq(incidentNote.authorId, author.id))
      .where(eq(incidentNote.incidentId, id))
      .orderBy(asc(incidentNote.writtenAt)),
    suspensionsWhere(db, eq(suspension.incidentId, id), now),
  ]);
  if (!g) return null;
  return { ...found, game: g, people, notes, suspensions };
}

export type ReviewError = "not_found" | "already_resolved" | "not_resolved";

async function lockIncident(db: Db, id: IncidentId) {
  const [row] = await db
    .select({ id: incident.id, status: incident.status })
    .from(incident)
    .where(eq(incident.id, id))
    .for("update");
  return row ?? null;
}

/** An admin's note on a report. */
export async function addIncidentNote(
  db: Db,
  input: { incidentId: IncidentId; authorId: UserId; body: string; now: Date },
): Promise<Result<void, ReviewError>> {
  return db.transaction(async (tx) => {
    if (!(await lockIncident(tx, input.incidentId))) return err("not_found");
    await tx.insert(incidentNote).values({
      incidentId: input.incidentId,
      authorId: input.authorId,
      body: input.body,
      writtenAt: input.now,
    });
    await recordAudit(tx, {
      actorId: input.authorId,
      action: "incident.note",
      entityType: "incident",
      entityId: input.incidentId,
    });
    return ok(undefined);
  });
}

/** Marks a report resolved, or opens it again. */
export async function setIncidentStatus(
  db: Db,
  input: {
    incidentId: IncidentId;
    actorId: UserId;
    status: "open" | "resolved";
    now: Date;
  },
): Promise<Result<void, ReviewError>> {
  return db.transaction(async (tx) => {
    const found = await lockIncident(tx, input.incidentId);
    if (!found) return err("not_found");
    if (found.status === input.status)
      return err(
        input.status === "resolved" ? "already_resolved" : "not_resolved",
      );
    const resolved = input.status === "resolved";
    await tx
      .update(incident)
      .set({
        status: input.status,
        resolvedAt: resolved ? input.now : null,
        resolvedBy: resolved ? input.actorId : null,
      })
      .where(eq(incident.id, input.incidentId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: resolved ? "incident.resolve" : "incident.reopen",
      entityType: "incident",
      entityId: input.incidentId,
      before: { status: found.status },
      after: { status: input.status },
    });
    return ok(undefined);
  });
}

// ------------------------------------------------------------ suspensions

const lengthOf = (row: {
  scope: "games" | "season" | "permanent";
  games: number | null;
}): SuspensionLength =>
  row.scope === "games"
    ? { scope: "games", games: row.games ?? 1 }
    : { scope: row.scope };

/**
 * Suspensions matching `where`, each with where it stands. Games served are
 * the suspended player's team games, on any team they are active on, that
 * kicked off after the suspension began and are now final or forfeited.
 * Three queries however many rows.
 */
async function suspensionsWhere(
  db: Db,
  where: SQL | undefined,
  now: Date,
): Promise<SuspensionView[]> {
  const rows = await db
    .select({
      id: suspension.id,
      userId: suspension.userId,
      name: user.name,
      incidentId: suspension.incidentId,
      scope: suspension.scope,
      games: suspension.games,
      startsAt: suspension.startsAt,
      liftedAt: suspension.liftedAt,
      seasonName: season.name,
      seasonStatus: season.status,
      seasonEndsOn: season.endsOn,
      timeZone: league.timezone,
    })
    .from(suspension)
    .innerJoin(user, eq(suspension.userId, user.id))
    .innerJoin(season, eq(suspension.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(where)
    .orderBy(desc(suspension.startsAt));
  const counting = rows.filter((r) => r.scope === "games" && !r.liftedAt);
  const served = new Map<SuspensionId, number>();
  if (counting.length > 0) {
    const counts = await db
      .select({ id: suspension.id, served: countDistinct(game.id) })
      .from(suspension)
      .innerJoin(registration, eq(registration.userId, suspension.userId))
      .innerJoin(
        rosterMembership,
        and(
          eq(rosterMembership.registrationId, registration.id),
          eq(rosterMembership.status, "active"),
        ),
      )
      .innerJoin(
        game,
        and(
          or(
            eq(game.teamAId, rosterMembership.teamSeasonId),
            eq(game.teamBId, rosterMembership.teamSeasonId),
          ),
          inArray(game.status, ["final", "forfeit"]),
        ),
      )
      .innerJoin(
        slot,
        and(eq(game.slotId, slot.id), gte(slot.startsAt, suspension.startsAt)),
      )
      .where(
        inArray(
          suspension.id,
          counting.map((r) => r.id),
        ),
      )
      .groupBy(suspension.id);
    for (const c of counts) served.set(c.id, c.served);
  }
  return rows.map((r) => {
    const length = lengthOf(r);
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      incidentId: r.incidentId,
      seasonName: r.seasonName,
      length,
      startsAt: r.startsAt,
      state: suspensionState({
        length,
        liftedAt: r.liftedAt,
        gamesServed: served.get(r.id) ?? 0,
        seasonOver: seasonIsOver(
          { status: r.seasonStatus, endsOn: r.seasonEndsOn },
          localDate(now, r.timeZone),
        ),
      }),
    };
  });
}

/** Suspensions still in force across the league, newest first, for admins. */
export async function activeSuspensions(
  db: Db,
  now: Date,
): Promise<SuspensionView[]> {
  const rows = await suspensionsWhere(db, isNull(suspension.liftedAt), now);
  return rows.filter((s) => s.state.state === "active");
}

export type SuspendedMark = {
  /** What a captain sees: that the player is out, and for how long still. */
  label: string;
  length: SuspensionLength;
  gamesLeft: number | null;
};

/**
 * Who among `userIds` is suspended right now. When a person has more than
 * one suspension in force, the longest wins.
 */
export async function suspendedAmong(
  db: Db,
  userIds: readonly UserId[],
  now: Date,
): Promise<Map<UserId, SuspendedMark>> {
  const marks = new Map<UserId, SuspendedMark>();
  if (userIds.length === 0) return marks;
  const rows = await suspensionsWhere(
    db,
    and(
      inArray(suspension.userId, [...new Set(userIds)]),
      isNull(suspension.liftedAt),
    ),
    now,
  );
  const weight = (m: SuspendedMark) =>
    m.length.scope === "permanent"
      ? Number.MAX_SAFE_INTEGER
      : m.length.scope === "season"
        ? Number.MAX_SAFE_INTEGER - 1
        : (m.gamesLeft ?? 0);
  for (const s of rows) {
    if (s.state.state !== "active") continue;
    const mark = {
      length: s.length,
      gamesLeft: s.state.gamesLeft,
      label: suspendedLabel(s.length, s.state.gamesLeft),
    };
    const before = marks.get(s.userId);
    if (!before || weight(mark) > weight(before)) marks.set(s.userId, mark);
  }
  return marks;
}

/** Whether a person is suspended right now. */
export async function isSuspended(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<boolean> {
  return (await suspendedAmong(db, [userId], now)).has(userId);
}

/** Whether anyone holding these registrations is suspended right now. */
export async function anySuspendedRegistration(
  db: Db,
  registrationIds: readonly RegistrationId[],
  now: Date,
): Promise<boolean> {
  if (registrationIds.length === 0) return false;
  const people = await db
    .select({ userId: registration.userId })
    .from(registration)
    .where(inArray(registration.id, [...registrationIds]));
  const marks = await suspendedAmong(
    db,
    people.map((p) => p.userId),
    now,
  );
  return marks.size > 0;
}

/**
 * Earlier outside-alcohol suspensions a player has, for the rulebook 4.0
 * ladder. Lifted ones (an appeal that succeeded) do not count, nor any
 * from `excluding`, the incident being decided.
 */
export async function earlierAlcoholSuspensions(
  db: Db,
  userId: UserId,
  excluding: IncidentId,
): Promise<number> {
  const rows = await db
    .select({ id: suspension.id })
    .from(suspension)
    .innerJoin(incident, eq(suspension.incidentId, incident.id))
    .where(
      and(
        eq(suspension.userId, userId),
        eq(incident.kind, "outside_alcohol"),
        isNull(suspension.liftedAt),
        ne(suspension.incidentId, excluding),
      ),
    );
  return rows.length;
}

export type SuspendError = "not_found" | "not_involved" | "already_suspended";

/** The suspension email (src/emails/suspension.ts). */
export type SuspensionPayload = {
  seasonName: string;
  length: string;
  scope: SuspensionLength["scope"];
  leagueName: string;
  /** Where to write besides replying, when the league lists an address. */
  leagueEmail: string | null;
};

/**
 * Suspends a person named on an incident, from now. Sends them one email
 * with the length and how to appeal; never says who reported it.
 */
export async function suspendPlayer(
  db: Db,
  input: {
    incidentId: IncidentId;
    userId: UserId;
    length: SuspensionLength;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<SuspensionId, SuspendError>> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        seasonId: game.seasonId,
        seasonName: season.name,
        leagueName: league.name,
        contact: league.contact,
      })
      .from(incident)
      .innerJoin(game, eq(incident.gameId, game.id))
      .innerJoin(season, eq(game.seasonId, season.id))
      .innerJoin(league, eq(season.leagueId, league.id))
      .where(eq(incident.id, input.incidentId))
      .for("update", { of: incident });
    if (!found) return err("not_found");
    const [named] = await tx
      .select({ userId: incidentPerson.userId })
      .from(incidentPerson)
      .where(
        and(
          eq(incidentPerson.incidentId, input.incidentId),
          eq(incidentPerson.userId, input.userId),
        ),
      );
    if (!named) return err("not_involved");
    const [created] = await tx
      .insert(suspension)
      .values({
        userId: input.userId,
        incidentId: input.incidentId,
        seasonId: found.seasonId,
        scope: input.length.scope,
        games: input.length.scope === "games" ? input.length.games : null,
        startsAt: input.now,
        issuedBy: input.actorId,
      })
      .onConflictDoNothing()
      .returning({ id: suspension.id });
    if (!created) return err("already_suspended");
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "suspension.issue",
      entityType: "suspension",
      entityId: created.id,
      after: {
        scope: input.length.scope,
        games: input.length.scope === "games" ? input.length.games : null,
      },
    });
    await enqueueMessages(tx, [
      {
        userId: input.userId,
        topic: "discipline",
        template: "suspension",
        payload: {
          seasonName: found.seasonName,
          length: describeLength(input.length),
          scope: input.length.scope,
          leagueName: found.leagueName,
          leagueEmail: found.contact.email ?? null,
        } satisfies SuspensionPayload,
        dedupeKey: `suspension/${created.id}`,
        sendAfter: input.now,
      },
    ]);
    return ok(created.id);
  });
}

export type LiftError = "not_found" | "already_lifted";

/** Ends a suspension early, for example after an appeal. No email. */
export async function liftSuspension(
  db: Db,
  input: { suspensionId: SuspensionId; actorId: UserId; now: Date },
): Promise<Result<IncidentId, LiftError>> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        incidentId: suspension.incidentId,
        liftedAt: suspension.liftedAt,
      })
      .from(suspension)
      .where(eq(suspension.id, input.suspensionId))
      .for("update");
    if (!found) return err("not_found");
    if (found.liftedAt) return err("already_lifted");
    await tx
      .update(suspension)
      .set({ liftedAt: input.now, liftedBy: input.actorId })
      .where(eq(suspension.id, input.suspensionId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "suspension.lift",
      entityType: "suspension",
      entityId: input.suspensionId,
    });
    return ok(found.incidentId);
  });
}

// ---------------------------------------------------------- personal data

/** A person's own discipline records, for their data export. */
export async function myDisciplineRecords(db: Db, userId: UserId, now: Date) {
  const [involved, filed, suspensions, ratings] = await Promise.all([
    db
      .select({
        kind: incident.kind,
        details: incident.details,
        status: incident.status,
        reportedAt: incident.reportedAt,
      })
      .from(incidentPerson)
      .innerJoin(incident, eq(incidentPerson.incidentId, incident.id))
      .where(eq(incidentPerson.userId, userId))
      .orderBy(asc(incident.reportedAt)),
    db
      .select({
        kind: incident.kind,
        details: incident.details,
        status: incident.status,
        reportedAt: incident.reportedAt,
      })
      .from(incident)
      .where(eq(incident.reportedBy, userId))
      .orderBy(asc(incident.reportedAt)),
    suspensionsWhere(db, eq(suspension.userId, userId), now),
    db
      .select({
        score: sportsmanshipRating.score,
        note: sportsmanshipRating.note,
        ratedAt: sportsmanshipRating.ratedAt,
      })
      .from(sportsmanshipRating)
      .where(eq(sportsmanshipRating.ratedBy, userId))
      .orderBy(asc(sportsmanshipRating.ratedAt)),
  ]);
  return {
    incidentsAboutYou: involved,
    incidentsYouReported: filed,
    suspensions: suspensions.map((s) => ({
      season: s.seasonName,
      length: describeLength(s.length),
      startedAt: s.startsAt,
      status: s.state.state,
    })),
    sportsmanshipRatingsYouGave: ratings,
  };
}

/**
 * When an account is deleted: the notes the person wrote come out (their
 * rating notes and review notes); incidents, suspensions and ratings stay
 * as league records, pointing at the anonymized account.
 */
export async function removeDisciplineNotes(
  db: Db,
  userId: UserId,
): Promise<void> {
  await db.delete(incidentNote).where(eq(incidentNote.authorId, userId));
  await db
    .update(sportsmanshipRating)
    .set({ note: null })
    .where(eq(sportsmanshipRating.ratedBy, userId));
}
