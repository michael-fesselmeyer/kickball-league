import { and, desc, eq, inArray, lt, ne, notLike, sql } from "drizzle-orm";
import type { LeagueId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  type Candidate,
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  type LastRole,
  LOOKBACK_SEASONS,
  rankCandidates,
  stateOf,
  winBackMessage,
} from "@/domain/win-back/win-back";
import { user } from "../schema/auth";
import { notificationPreference } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { winBackEmail, winBackTemplate } from "../schema/win-back";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * The win-back list (issue #370): past players who haven't signed up for
 * the season whose registration is open, and the one email each may get.
 * Pages check `win_back.manage` before calling anything here.
 */

/** Registrations that made someone a member of a season. */
const MEMBER_STATUSES = [
  "pending_waiver",
  "pending_payment",
  "active",
] as const;

export type WinBackSeason = {
  id: SeasonId;
  leagueId: LeagueId;
  slug: string;
  name: string;
  startsOn: string;
  status: string;
};

/**
 * A season of the league by slug, as the win-back screen needs it. Slugs
 * are unique within a league only, so the league is part of the lookup.
 */
export async function winBackSeason(
  db: Db,
  leagueId: LeagueId | null | undefined,
  slug: string,
): Promise<WinBackSeason | null> {
  if (!leagueId) return null;
  const [found] = await db
    .select({
      id: season.id,
      leagueId: season.leagueId,
      slug: season.slug,
      name: season.name,
      startsOn: season.startsOn,
      status: season.status,
    })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), eq(season.slug, slug)));
  return found ?? null;
}

/** The league's wording for the email, or the default. */
export async function winBackTemplateOf(
  db: Db,
  leagueId: LeagueId,
): Promise<{ subject: string; body: string; custom: boolean }> {
  const [row] = await db
    .select({ subject: winBackTemplate.subject, body: winBackTemplate.body })
    .from(winBackTemplate)
    .where(eq(winBackTemplate.leagueId, leagueId));
  return row
    ? { ...row, custom: true }
    : { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY, custom: false };
}

/** Saves the league's wording; audited. */
export async function saveWinBackTemplate(
  db: Db,
  input: { leagueId: LeagueId; subject: string; body: string },
  actorId: UserId,
): Promise<void> {
  const values = {
    leagueId: input.leagueId,
    subject: input.subject,
    body: input.body,
    updatedAt: new Date(),
    updatedBy: actorId,
  };
  await db
    .insert(winBackTemplate)
    .values(values)
    .onConflictDoUpdate({ target: winBackTemplate.leagueId, set: values });
  await recordAudit(db, {
    actorId,
    action: "win_back.template",
    entityType: "league",
    entityId: input.leagueId,
  });
}

/**
 * Everyone who played in one of the few seasons before `target` and has no
 * registration in it (a cancelled one doesn't count), most loyal first.
 * Two reads: the seasons before, then every past registration of those
 * people with their team, opt-out and this season's email alongside.
 */
export async function winBackCandidates(
  db: Db,
  target: WinBackSeason,
): Promise<Candidate[]> {
  const earlier = await db
    .select({ id: season.id })
    .from(season)
    .where(
      and(
        eq(season.leagueId, target.leagueId),
        ne(season.status, "draft"),
        lt(season.startsOn, target.startsOn),
      ),
    )
    .orderBy(desc(season.startsOn));
  const recent = earlier.slice(0, LOOKBACK_SEASONS).map((s) => s.id);
  if (recent.length === 0) return [];

  const recentPlayers = db
    .selectDistinct({ userId: registration.userId })
    .from(registration)
    .where(
      and(
        inArray(registration.seasonId, recent),
        inArray(registration.status, [...MEMBER_STATUSES]),
      ),
    );
  const signedUp = db
    .select({ userId: registration.userId })
    .from(registration)
    .where(
      and(
        eq(registration.seasonId, target.id),
        ne(registration.status, "cancelled"),
      ),
    );
  // The registration's team and role: its active spot, else its latest one.
  const spotTeam = sql<string | null>`(
    select t.name from roster_membership rm
    join team_season ts on ts.id = rm.team_season_id
    join team t on t.id = ts.team_id
    where rm.registration_id = ${registration.id} and rm.status <> 'invited'
    order by (rm.status = 'active') desc, rm.created_at desc
    limit 1
  )`;
  const spotRole = sql<string | null>`(
    select rm.role::text from roster_membership rm
    where rm.registration_id = ${registration.id} and rm.status <> 'invited'
    order by (rm.status = 'active') desc, rm.created_at desc
    limit 1
  )`;
  const rows = await db
    .select({
      userId: registration.userId,
      kind: registration.kind,
      seasonId: registration.seasonId,
      seasonStart: season.startsOn,
      seasonName: season.name,
      team: spotTeam,
      role: spotRole,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accountName: user.name,
      optedOut: sql<boolean>`exists (
        select 1 from ${notificationPreference}
        where ${notificationPreference.userId} = ${registration.userId}
          and ${notificationPreference.topic} = 'announcement'
          and ${notificationPreference.channel} = 'email'
          and not ${notificationPreference.enabled}
      )`,
      emailedAt: sql<string | null>`(
        select ${winBackEmail.sentAt} from ${winBackEmail}
        where ${winBackEmail.seasonId} = ${target.id}
          and ${winBackEmail.userId} = ${registration.userId}
      )`,
    })
    .from(registration)
    .innerJoin(season, eq(season.id, registration.seasonId))
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(season.leagueId, target.leagueId),
        ne(season.status, "draft"),
        lt(season.startsOn, target.startsOn),
        inArray(registration.status, [...MEMBER_STATUSES]),
        inArray(registration.userId, recentPlayers),
        sql`${registration.userId} not in ${signedUp}`,
        notLike(user.email, "%@deleted.invalid"),
      ),
    );

  const byUser = new Map<UserId, typeof rows>();
  for (const r of rows)
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const candidates = [...byUser.values()].flatMap((regs): Candidate[] => {
    const last = [...regs].sort((a, b) =>
      a.seasonStart < b.seasonStart ? 1 : -1,
    )[0];
    if (!last) return [];
    // Only the captain is asked to register the team again: two co-captains
    // doing it too would enter the same team twice.
    const role: LastRole =
      last.role === "captain"
        ? "captain"
        : last.team === null && last.kind === "free_agent"
          ? "free_agent"
          : "player";
    return [
      {
        userId: last.userId,
        firstName:
          last.firstName?.trim() || last.accountName.split(" ")[0] || "there",
        name:
          last.firstName && last.lastName
            ? `${last.firstName} ${last.lastName}`
            : last.accountName,
        seasonsPlayed: new Set(regs.map((r) => r.seasonId)).size,
        lastSeasonStart: last.seasonStart,
        lastSeasonName: last.seasonName,
        lastTeam: last.team,
        lastRole: role,
        optedOut: last.optedOut,
        emailedAt: last.emailedAt === null ? null : new Date(last.emailedAt),
      },
    ];
  });
  return rankCandidates(candidates);
}

export type SendError = "not_open";

/**
 * Queues the win-back email for these people, at most once each this
 * season: only those still on the list, not opted out and not emailed
 * yet. Non-urgent, so it waits out quiet hours and the daily cap. Run it
 * in a transaction. Returns how many were queued.
 */
export async function sendWinBack(
  db: Db,
  input: {
    season: WinBackSeason;
    userIds: readonly string[] | "all";
    actorId: UserId;
    now: Date;
  },
): Promise<Result<number, SendError>> {
  if (input.season.status !== "registration_open") return err("not_open");
  const template = await winBackTemplateOf(db, input.season.leagueId);
  const wanted = input.userIds === "all" ? null : new Set(input.userIds);
  const due = (await winBackCandidates(db, input.season)).filter(
    (c) => stateOf(c) === "ready" && (wanted === null || wanted.has(c.userId)),
  );
  if (due.length === 0) return ok(0);
  const claimed = await db
    .insert(winBackEmail)
    .values(
      due.map((c) => ({
        seasonId: input.season.id,
        userId: c.userId,
        sentBy: input.actorId,
        sentAt: input.now,
      })),
    )
    .onConflictDoNothing({
      target: [winBackEmail.seasonId, winBackEmail.userId],
    })
    .returning({ userId: winBackEmail.userId });
  const fresh = new Set(claimed.map((c) => c.userId));
  const sending = due.filter((c) => fresh.has(c.userId));
  await enqueueMessages(
    db,
    sending.map((c) => ({
      userId: c.userId,
      template: "win_back" as const,
      // League news: someone who turned announcements off isn't emailed.
      topic: "announcement" as const,
      payload: winBackMessage(template, c, input.season),
      dedupeKey: `win_back/${input.season.id}/${c.userId}`,
    })),
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "win_back.send",
    entityType: "season",
    entityId: input.season.id,
    after: { emailed: sending.length },
  });
  return ok(sending.length);
}

/**
 * How a season's win-back emails did: how many went out, and how many of
 * those people registered for the season after their email.
 */
export async function winBackResults(
  db: Db,
  seasonId: SeasonId,
): Promise<{ emailed: number; cameBack: number }> {
  const [row] = await db
    .select({
      emailed: sql<number>`count(*)`.mapWith(Number),
      // Spelled out: in a one-table query the column names come out
      // unqualified, which inside this subquery would mean the registration.
      cameBack: sql<number>`count(*) filter (where exists (
        select 1 from registration r
        where r.season_id = win_back_email.season_id
          and r.user_id = win_back_email.user_id
          and r.status in ('pending_waiver', 'pending_payment', 'active')
          and r.created_at >= win_back_email.sent_at
      ))`.mapWith(Number),
    })
    .from(winBackEmail)
    .where(eq(winBackEmail.seasonId, seasonId));
  return { emailed: row?.emailed ?? 0, cameBack: row?.cameBack ?? 0 };
}
