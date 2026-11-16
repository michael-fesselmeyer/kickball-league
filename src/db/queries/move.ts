import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import type {
  LeagueId,
  MoveInterestId,
  MoveInviteId,
  RegistrationId,
  SeasonId,
  TeamId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  type Audience,
  clearsAt,
  isRecruiting,
  type InviteStatus,
} from "@/domain/move/move";
import { err, ok, type Result } from "@/domain/result";
import type {
  MoveAcceptedPayload,
  MoveInvitePayload,
} from "@/emails/team-change";
import { user } from "../schema/auth";
import { teamKeepOff } from "../schema/keep-off";
import { moveInterest, moveInvite } from "../schema/move";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * "Looking for a change" (ADR 0089): rows for src/domain/move. Every read
 * here is written for one audience, and none of them is ever reachable
 * from a team the person has played on:
 *
 * - the person themselves: `myMoveInterest`, `myMoveInvites`;
 * - admins, when the person lets them: `moveInterestsForAdmins`, and the
 *   matcher's `movingOnFor`;
 * - a recruiting captain, when the person lets captains: a count from
 *   `recruitingSummary`, and names only for invites the person accepted.
 *
 * Nothing here writes the audit log, which admins read: a person who chose
 * "captains only" would otherwise be shown to admins.
 */

/** "Jo S.", or the account name. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;
/** "Jo Smith", or the account name, or the address. */
const fullName = sql<string>`coalesce(nullif(trim(coalesce(${profile.firstName}, '') || ' ' || coalesce(${profile.lastName}, '')), ''), nullif(${user.name}, ''), ${user.email})`;

/** When a season's registration closes; one with no date closes as it starts. */
const closing = sql`coalesce(${season.registrationClosesAt}, ${season.startsOn}::timestamptz)`;

/**
 * The row still counts: no league season's registration has closed since
 * it was set (`isActive` in src/domain/move, as SQL). Private events
 * (ADR 0049) don't count as next season.
 */
const active = (db: Db, now: Date) =>
  notExists(
    db
      .select({ one: sql`1` })
      .from(season)
      .where(
        and(
          eq(season.leagueId, moveInterest.leagueId),
          eq(season.visibility, "league"),
          sql`${closing} > ${moveInterest.createdAt}`,
          sql`${closing} <= ${now.toISOString()}::timestamptz`,
        ),
      ),
  );

const seenByCaptains = inArray(moveInterest.audience, ["captains", "both"]);
const seenByAdmins = inArray(moveInterest.audience, ["admins", "both"]);

/**
 * The person has been on this lasting team's roster in any season, in any
 * state (invited, playing or removed). Such a team never sees their flag.
 */
const playedFor = (db: Db, teamId: TeamId) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(registration)
      .innerJoin(
        rosterMembership,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .where(
        and(
          eq(registration.userId, moveInterest.userId),
          eq(teamSeason.teamId, teamId),
        ),
      ),
  );

/** The team keeps the person off (ADR 0036): it never sees or invites them. */
const keptOffBy = (db: Db, teamId: TeamId) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(teamKeepOff)
      .where(
        and(
          eq(teamKeepOff.teamId, teamId),
          eq(teamKeepOff.userId, moveInterest.userId),
        ),
      ),
  );

/** Closing times of the league's seasons, for `clearsAt`. */
async function closings(db: Db, leagueId: LeagueId): Promise<Date[]> {
  const rows = await db
    .select({ at: sql<string>`${closing}` })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), eq(season.visibility, "league")));
  return rows.map((r) => new Date(r.at));
}

export type MyMove = {
  id: MoveInterestId;
  audience: Audience;
  note: string | null;
  since: Date;
  /** When it clears by itself; null until next season has a closing date. */
  clearsAt: Date | null;
};

/** The person's own flag in this league, if it still counts. */
export async function myMoveInterest(
  db: Db,
  userId: UserId,
  leagueId: LeagueId,
  now: Date,
): Promise<MyMove | null> {
  const [[row], times] = await Promise.all([
    db
      .select({
        id: moveInterest.id,
        audience: moveInterest.audience,
        note: moveInterest.note,
        since: moveInterest.createdAt,
      })
      .from(moveInterest)
      .where(
        and(
          eq(moveInterest.userId, userId),
          eq(moveInterest.leagueId, leagueId),
          active(db, now),
        ),
      ),
    closings(db, leagueId),
  ]);
  if (!row) return null;
  return { ...row, clearsAt: clearsAt(row.since, times) };
}

/**
 * Sets or changes the person's flag. One that has cleared starts over: its
 * old invites go, and the new one counts until the next close after now.
 * Run it in a transaction.
 */
export async function setMoveInterest(
  db: Db,
  input: {
    userId: UserId;
    leagueId: LeagueId;
    audience: Audience;
    note: string | null;
    now: Date;
  },
): Promise<void> {
  const where = and(
    eq(moveInterest.userId, input.userId),
    eq(moveInterest.leagueId, input.leagueId),
  );
  const [current] = await db
    .select({ id: moveInterest.id })
    .from(moveInterest)
    .where(and(where, active(db, input.now)))
    .for("update");
  if (current) {
    await db
      .update(moveInterest)
      .set({ audience: input.audience, note: input.note })
      .where(eq(moveInterest.id, current.id));
    return;
  }
  await db.delete(moveInterest).where(where);
  await db.insert(moveInterest).values({
    leagueId: input.leagueId,
    userId: input.userId,
    audience: input.audience,
    note: input.note,
    createdAt: input.now,
  });
}

/** Withdraws the flag, and every invite it got. Nobody is told. */
export async function withdrawMoveInterest(
  db: Db,
  userId: UserId,
  leagueId: LeagueId,
): Promise<boolean> {
  const removed = await db
    .delete(moveInterest)
    .where(
      and(eq(moveInterest.userId, userId), eq(moveInterest.leagueId, leagueId)),
    )
    .returning({ id: moveInterest.id });
  return removed.length > 0;
}

export type MyInvite = {
  id: MoveInviteId;
  team: string;
  seasonName: string;
  message: string | null;
  status: InviteStatus;
  sentAt: Date;
  /**
   * One of the inviting team's captains plays with the person on a team
   * this season, so a "yes" would tell a current teammate.
   */
  teammateCaptains: boolean;
};

/** Whether a captain of the invite's team plays with `userId` in a season not over yet. */
const teammateCaptains = (userId: UserId) => sql<boolean>`exists (
  select 1 from roster_membership cm
  join team_season cts on cts.id = cm.team_season_id
  join registration cr on cr.id = cm.registration_id
  join registration cr2 on cr2.user_id = cr.user_id
  join roster_membership cm2 on cm2.registration_id = cr2.id and cm2.status = 'active'
  join team_season ts2 on ts2.id = cm2.team_season_id
  join season s2 on s2.id = ts2.season_id and s2.status <> 'completed'
  join roster_membership pm on pm.team_season_id = ts2.id and pm.status = 'active'
  join registration pr on pr.id = pm.registration_id
  where cts.team_id = ${moveInvite.teamId}
    and cts.season_id = ${moveInvite.seasonId}
    and cm.status = 'active'
    and cm.role in ('captain', 'co_captain')
    and pr.user_id = ${userId}
    and cr.user_id <> ${userId}
)`;

/** The invites the person's flag has had, newest first. */
export async function myMoveInvites(
  db: Db,
  userId: UserId,
  leagueId: LeagueId,
  now: Date,
): Promise<MyInvite[]> {
  return db
    .select({
      id: moveInvite.id,
      team: team.name,
      seasonName: season.name,
      message: moveInvite.message,
      status: moveInvite.status,
      sentAt: moveInvite.createdAt,
      teammateCaptains: teammateCaptains(userId),
    })
    .from(moveInvite)
    .innerJoin(moveInterest, eq(moveInvite.interestId, moveInterest.id))
    .innerJoin(team, eq(moveInvite.teamId, team.id))
    .innerJoin(season, eq(moveInvite.seasonId, season.id))
    .where(
      and(
        eq(moveInterest.userId, userId),
        eq(moveInterest.leagueId, leagueId),
        active(db, now),
      ),
    )
    .orderBy(desc(moveInvite.createdAt), asc(team.name));
}

export type AnswerError = "not_found" | "answered";

/**
 * The person's answer to one of their invites. Saying yes tells the team's
 * captains who they are, by message and on the team page; saying no tells
 * nobody. A "no" can become a "yes" later; a "yes" stands until the person
 * withdraws their flag. Run it in a transaction.
 */
export async function answerMoveInvite(
  db: Db,
  input: { id: MoveInviteId; userId: UserId; accept: boolean; now: Date },
): Promise<Result<void, AnswerError>> {
  const [invite] = await db
    .select({
      status: moveInvite.status,
      teamId: moveInvite.teamId,
      seasonId: moveInvite.seasonId,
      audience: moveInterest.audience,
    })
    .from(moveInvite)
    .innerJoin(moveInterest, eq(moveInvite.interestId, moveInterest.id))
    .where(
      and(
        eq(moveInvite.id, input.id),
        eq(moveInterest.userId, input.userId),
        active(db, input.now),
      ),
    )
    .for("update", { of: moveInvite });
  if (!invite) return err("not_found");
  const next = input.accept ? "accepted" : "declined";
  if (invite.status === next) return ok(undefined);
  if (invite.status === "accepted") return err("answered");
  await db
    .update(moveInvite)
    .set({ status: next, respondedAt: input.now })
    .where(eq(moveInvite.id, input.id));
  // A flag that no longer lets captains see it tells the team nothing.
  if (!input.accept || invite.audience === "admins") return ok(undefined);

  // The team's captains and co-captains for the season it is recruiting
  // for, by message. Only now does the team learn the name.
  const [captains, [who]] = await Promise.all([
    db
      .select({
        userId: registration.userId,
        team: team.name,
        seasonName: season.name,
        seasonSlug: season.slug,
      })
      .from(rosterMembership)
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .innerJoin(season, eq(teamSeason.seasonId, season.id))
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .where(
        and(
          eq(teamSeason.teamId, invite.teamId),
          eq(teamSeason.seasonId, invite.seasonId),
          eq(rosterMembership.status, "active"),
          inArray(rosterMembership.role, ["captain", "co_captain"]),
        ),
      ),
    db
      .select({ name: shortName })
      .from(user)
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(eq(user.id, input.userId)),
  ]);
  await enqueueMessages(
    db,
    captains.map((c) => ({
      userId: c.userId,
      topic: "team_roles" as const,
      template: "move_accepted" as const,
      payload: {
        team: c.team,
        seasonName: c.seasonName,
        seasonSlug: c.seasonSlug,
        player: who?.name ?? "A player",
      } satisfies MoveAcceptedPayload,
      dedupeKey: `move-invite/${input.id}/accepted/${c.userId}`,
      sendAfter: input.now,
    })),
  );
  return ok(undefined);
}

export type Recruiting = {
  teamId: TeamId;
  teamName: string;
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  leagueId: LeagueId;
};

/**
 * The team and season a captain's page is for, when that season is still
 * recruiting (draft or registration open, not past its close). Private
 * events (ADR 0049) never recruit from the league.
 */
export async function recruitingTeam(
  db: Db,
  teamSeasonId: TeamSeasonId,
  now: Date,
): Promise<Recruiting | null> {
  const [row] = await db
    .select({
      teamId: team.id,
      teamName: team.name,
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      leagueId: season.leagueId,
      status: season.status,
      visibility: season.visibility,
      closesAt: season.registrationClosesAt,
    })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(eq(teamSeason.id, teamSeasonId));
  if (!row || row.visibility !== "league") return null;
  if (!isRecruiting(row.status, row.closesAt, now)) return null;
  return {
    teamId: row.teamId,
    teamName: row.teamName,
    seasonId: row.seasonId,
    seasonName: row.seasonName,
    seasonSlug: row.seasonSlug,
    leagueId: row.leagueId,
  };
}

/** Flags this team may count: open to captains, never its own players'. */
const countableBy = (db: Db, r: Recruiting, now: Date) =>
  and(
    eq(moveInterest.leagueId, r.leagueId),
    seenByCaptains,
    active(db, now),
    sql`not ${playedFor(db, r.teamId)}`,
    sql`not ${keptOffBy(db, r.teamId)}`,
  );

const notInvitedBy = (db: Db, teamId: TeamId) =>
  notExists(
    db
      .select({ one: sql`1` })
      .from(moveInvite)
      .where(
        and(
          eq(moveInvite.interestId, moveInterest.id),
          eq(moveInvite.teamId, teamId),
        ),
      ),
  );

export type RecruitingSummary = {
  /** Players open to a move this team may invite and hasn't yet. */
  waiting: number;
  /** Invites this team has sent that still count, answered or not. */
  invited: number;
  /** Players who said yes: the only names a team ever sees. */
  accepted: { name: string; email: string; note: string | null }[];
};

/**
 * What a recruiting captain sees: counts, and the names of players who
 * accepted. Pending and declined invites read the same, so a "no" is
 * never seen.
 */
export async function recruitingSummary(
  db: Db,
  r: Recruiting,
  now: Date,
): Promise<RecruitingSummary> {
  const [[waiting], [invited], accepted] = await Promise.all([
    db
      .select({ n: count() })
      .from(moveInterest)
      .where(and(countableBy(db, r, now), notInvitedBy(db, r.teamId))),
    db
      .select({ n: count() })
      .from(moveInvite)
      .innerJoin(moveInterest, eq(moveInvite.interestId, moveInterest.id))
      .where(
        and(
          eq(moveInvite.teamId, r.teamId),
          eq(moveInvite.seasonId, r.seasonId),
          active(db, now),
        ),
      ),
    db
      .select({
        name: fullName,
        email: user.email,
        note: moveInterest.note,
      })
      .from(moveInvite)
      .innerJoin(moveInterest, eq(moveInvite.interestId, moveInterest.id))
      .innerJoin(user, eq(moveInterest.userId, user.id))
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(
        and(
          eq(moveInvite.teamId, r.teamId),
          eq(moveInvite.seasonId, r.seasonId),
          eq(moveInvite.status, "accepted"),
          seenByCaptains,
          active(db, now),
        ),
      )
      .orderBy(asc(moveInvite.respondedAt)),
  ]);
  return {
    waiting: waiting?.n ?? 0,
    invited: invited?.n ?? 0,
    accepted,
  };
}

/**
 * Invites every player this team may invite and hasn't, without learning
 * who they are, and tells each of them. Returns how many. Run it in a
 * transaction.
 */
export async function inviteOpenPlayers(
  db: Db,
  input: {
    recruiting: Recruiting;
    actorId: UserId;
    message: string | null;
    now: Date;
  },
): Promise<number> {
  const r = input.recruiting;
  const open = await db
    .select({ id: moveInterest.id, userId: moveInterest.userId })
    .from(moveInterest)
    .where(and(countableBy(db, r, input.now), notInvitedBy(db, r.teamId)));
  if (open.length === 0) return 0;
  const created = await db
    .insert(moveInvite)
    .values(
      open.map((o) => ({
        interestId: o.id,
        teamId: r.teamId,
        seasonId: r.seasonId,
        sentBy: input.actorId,
        message: input.message,
        createdAt: input.now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: moveInvite.id, interestId: moveInvite.interestId });
  const userOf = new Map(open.map((o) => [o.id, o.userId]));
  await enqueueMessages(
    db,
    created.flatMap((c) => {
      const userId = userOf.get(c.interestId);
      return userId
        ? [
            {
              userId,
              topic: "team_roles" as const,
              template: "move_invite" as const,
              payload: {
                team: r.teamName,
                seasonName: r.seasonName,
                seasonSlug: r.seasonSlug,
                message: input.message,
              } satisfies MoveInvitePayload,
              dedupeKey: `move-invite/${c.id}`,
              sendAfter: input.now,
            },
          ]
        : [];
    }),
  );
  return created.length;
}

export type AdminMoveRow = {
  userId: UserId;
  name: string;
  email: string;
  audience: Audience;
  note: string | null;
  since: Date;
  /** Their teams in seasons not over yet. */
  teams: string[];
  /** Teams whose invite they said yes to; never who they said no to. */
  saidYesTo: string[];
};

/** Everyone open to a move who lets admins see it, oldest first. */
export async function moveInterestsForAdmins(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<AdminMoveRow[]> {
  const rows = await db
    .select({
      id: moveInterest.id,
      userId: moveInterest.userId,
      name: fullName,
      email: user.email,
      audience: moveInterest.audience,
      note: moveInterest.note,
      since: moveInterest.createdAt,
    })
    .from(moveInterest)
    .innerJoin(user, eq(moveInterest.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(eq(moveInterest.leagueId, leagueId), seenByAdmins, active(db, now)),
    )
    .orderBy(asc(moveInterest.createdAt), asc(moveInterest.id));
  if (rows.length === 0) return [];
  const [teams, invites] = await Promise.all([
    db
      .selectDistinct({ userId: registration.userId, team: team.name })
      .from(registration)
      .innerJoin(season, eq(registration.seasonId, season.id))
      .innerJoin(
        rosterMembership,
        and(
          eq(rosterMembership.registrationId, registration.id),
          eq(rosterMembership.status, "active"),
        ),
      )
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          inArray(
            registration.userId,
            rows.map((r) => r.userId),
          ),
          eq(season.leagueId, leagueId),
          ne(season.status, "completed"),
        ),
      ),
    db
      .select({ interestId: moveInvite.interestId, team: team.name })
      .from(moveInvite)
      .innerJoin(team, eq(moveInvite.teamId, team.id))
      .where(
        and(
          inArray(
            moveInvite.interestId,
            rows.map((r) => r.id),
          ),
          eq(moveInvite.status, "accepted"),
        ),
      )
      .orderBy(asc(team.name)),
  ]);
  return rows.map(({ id, ...r }) => ({
    ...r,
    teams: teams
      .filter((t) => t.userId === r.userId)
      .map((t) => t.team)
      .sort(),
    saidYesTo: invites.filter((i) => i.interestId === id).map((i) => i.team),
  }));
}

/**
 * For the matcher (ADR 0012): the season's free agents who are looking for
 * a change and let admins see it, and, for each of the season's teams,
 * those of them who have played for it before.
 */
export async function movingOnFor(
  db: Db,
  seasonId: SeasonId,
  now: Date,
): Promise<{
  movers: Set<RegistrationId>;
  byTeam: Map<TeamSeasonId, RegistrationId[]>;
}> {
  const movers = await db
    .select({ registrationId: registration.id, userId: registration.userId })
    .from(registration)
    .innerJoin(season, eq(registration.seasonId, season.id))
    .innerJoin(
      moveInterest,
      and(
        eq(moveInterest.userId, registration.userId),
        eq(moveInterest.leagueId, season.leagueId),
      ),
    )
    .where(
      and(eq(registration.seasonId, seasonId), seenByAdmins, active(db, now)),
    );
  const byTeam = new Map<TeamSeasonId, RegistrationId[]>();
  if (movers.length === 0) return { movers: new Set(), byTeam };
  const past = db.$with("past").as(
    db
      .selectDistinct({
        userId: registration.userId,
        teamId: teamSeason.teamId,
      })
      .from(registration)
      .innerJoin(
        rosterMembership,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .where(
        inArray(
          registration.userId,
          movers.map((m) => m.userId),
        ),
      ),
  );
  const played = await db
    .with(past)
    .select({ teamSeasonId: teamSeason.id, userId: past.userId })
    .from(teamSeason)
    .innerJoin(past, eq(past.teamId, teamSeason.teamId))
    .where(eq(teamSeason.seasonId, seasonId));
  for (const p of played)
    for (const m of movers)
      if (m.userId === p.userId)
        byTeam.set(p.teamSeasonId, [
          ...(byTeam.get(p.teamSeasonId) ?? []),
          m.registrationId,
        ]);
  return { movers: new Set(movers.map((m) => m.registrationId)), byTeam };
}

/**
 * Deletes flags that have cleared, with their invites (the daily purge).
 * Reads already ignore them; this keeps nothing longer than it is needed.
 */
export async function purgeClearedMoves(db: Db, now: Date): Promise<number> {
  const removed = await db
    .delete(moveInterest)
    .where(sql`not ${active(db, now)}`)
    .returning({ id: moveInterest.id });
  return removed.length;
}

/** For the person's data export: their flag and its invites, and invites they sent for a team. */
export async function myMoveData(db: Db, userId: UserId) {
  const [interests, received, sent] = await Promise.all([
    db
      .select({
        leagueId: moveInterest.leagueId,
        audience: moveInterest.audience,
        note: moveInterest.note,
        since: moveInterest.createdAt,
      })
      .from(moveInterest)
      .where(eq(moveInterest.userId, userId)),
    db
      .select({
        team: team.name,
        season: season.name,
        message: moveInvite.message,
        status: moveInvite.status,
        sentAt: moveInvite.createdAt,
        answeredAt: moveInvite.respondedAt,
      })
      .from(moveInvite)
      .innerJoin(moveInterest, eq(moveInvite.interestId, moveInterest.id))
      .innerJoin(team, eq(moveInvite.teamId, team.id))
      .innerJoin(season, eq(moveInvite.seasonId, season.id))
      .where(eq(moveInterest.userId, userId)),
    // What the captain wrote and when, never to whom or who answered:
    // the team only ever learns the names of those who said yes.
    db
      .select({
        team: team.name,
        season: season.name,
        message: moveInvite.message,
        sentAt: moveInvite.createdAt,
        players: count(),
      })
      .from(moveInvite)
      .innerJoin(team, eq(moveInvite.teamId, team.id))
      .innerJoin(season, eq(moveInvite.seasonId, season.id))
      .where(eq(moveInvite.sentBy, userId))
      .groupBy(
        team.name,
        season.name,
        moveInvite.message,
        moveInvite.createdAt,
      ),
  ]);
  return {
    lookingForAChange: interests,
    invitesReceived: received,
    invitesSent: sent,
  };
}
