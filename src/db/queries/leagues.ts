import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { LeagueId, UserId } from "@/domain/ids";
import { DEFAULT_LEAGUE_SEGMENT } from "@/domain/league/paths";
import type { LeagueRole, NewLeagueInput } from "@/domain/league/new-league";
import { err, ok, type Result } from "@/domain/result";
import { ruleSet } from "../schema/division";
import { type LeagueBranding, league, leagueMember } from "../schema/league";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/** What pages, links and permission checks need to know about a league. */
export type LeagueInfo = {
  id: LeagueId;
  name: string;
  slug: string;
  sport: string;
  timeZone: string;
  isDefault: boolean;
  minimumAge: number;
  branding: LeagueBranding;
};

const INFO = {
  id: league.id,
  name: league.name,
  slug: league.slug,
  sport: league.sport,
  timeZone: league.timezone,
  isDefault: league.isDefault,
  minimumAge: league.minimumAge,
  branding: league.branding,
};

/**
 * The league served at the site's own URLs: the one marked default, or the
 * oldest when none is (a database from before ADR 0048, or a fresh one).
 */
export async function defaultLeague(db: Db): Promise<LeagueInfo | null> {
  const [found] = await db
    .select(INFO)
    .from(league)
    .orderBy(desc(league.isDefault), asc(league.createdAt), asc(league.id))
    .limit(1);
  return found ? { ...found, isDefault: true } : null;
}

export async function leagueBySlug(
  db: Db,
  slug: string,
): Promise<LeagueInfo | null> {
  const [found] = await db
    .select(INFO)
    .from(league)
    .where(eq(league.slug, slug));
  if (!found) return null;
  if (found.isDefault) return found;
  // The oldest league counts as the default until one is marked.
  const fallback = await defaultLeague(db);
  return { ...found, isDefault: fallback?.id === found.id };
}

/** The league of a public page's `[league]` segment. */
export async function leagueBySegment(
  db: Db,
  segment: string,
): Promise<LeagueInfo | null> {
  return segment === DEFAULT_LEAGUE_SEGMENT
    ? defaultLeague(db)
    : leagueBySlug(db, segment);
}

export async function leagueById(
  db: Db,
  id: LeagueId,
): Promise<LeagueInfo | null> {
  const [found] = await db.select(INFO).from(league).where(eq(league.id, id));
  if (!found) return null;
  const fallback = await defaultLeague(db);
  return { ...found, isDefault: fallback?.id === found.id };
}

/** Every league, the default first, then by name. */
export async function allLeagues(db: Db): Promise<LeagueInfo[]> {
  const rows = await db
    .select(INFO)
    .from(league)
    .orderBy(desc(league.isDefault), asc(league.createdAt), asc(league.id));
  return rows.map((row, i) => ({ ...row, isDefault: i === 0 }));
}

/**
 * The leagues a person belongs to: where they have a role, or have
 * registered for a season. The app's league switcher lists these.
 */
export async function leaguesOf(db: Db, userId: UserId): Promise<LeagueInfo[]> {
  const [all, members, players] = await Promise.all([
    allLeagues(db),
    db
      .select({ leagueId: leagueMember.leagueId })
      .from(leagueMember)
      .where(eq(leagueMember.userId, userId)),
    db
      .selectDistinct({ leagueId: season.leagueId })
      .from(registration)
      .innerJoin(season, eq(registration.seasonId, season.id))
      .where(eq(registration.userId, userId)),
  ]);
  const mine = new Set<string>([
    ...members.map((m) => m.leagueId),
    ...players.map((p) => p.leagueId),
  ]);
  return all.filter((l) => mine.has(l.id));
}

/** A person's role in one league; everyone signed in is at least a player. */
export async function leagueRoleOf(
  db: Db,
  userId: UserId,
  leagueId: LeagueId,
): Promise<LeagueRole> {
  const [row] = await db
    .select({ role: leagueMember.role })
    .from(leagueMember)
    .where(
      and(eq(leagueMember.userId, userId), eq(leagueMember.leagueId, leagueId)),
    );
  return row?.role ?? "player";
}

/** The people with a role above player in a league, owners first. */
export async function leagueStaff(db: Db, leagueId: LeagueId) {
  return db
    .select({ userId: leagueMember.userId, role: leagueMember.role })
    .from(leagueMember)
    .where(
      and(eq(leagueMember.leagueId, leagueId), ne(leagueMember.role, "player")),
    )
    .orderBy(desc(leagueMember.role), asc(leagueMember.userId));
}

/** Everyone with one of `roles` in a league, for notices to its admins. */
export async function leagueUsersWithRole(
  db: Db,
  leagueId: LeagueId,
  roles: readonly LeagueRole[],
): Promise<UserId[]> {
  const rows = await db
    .select({ userId: leagueMember.userId })
    .from(leagueMember)
    .where(
      and(
        eq(leagueMember.leagueId, leagueId),
        inArray(leagueMember.role, [...roles]),
      ),
    )
    .orderBy(asc(leagueMember.userId));
  return rows.map((r) => r.userId);
}

/**
 * Give a person a role in one league, audited in that league. Setting
 * "player" keeps the row, so the league stays in their switcher.
 */
export async function setLeagueRole(
  db: Db,
  input: {
    leagueId: LeagueId;
    userId: UserId;
    role: LeagueRole;
    actorId: UserId;
  },
): Promise<void> {
  const before = await leagueRoleOf(db, input.userId, input.leagueId);
  await db
    .insert(leagueMember)
    .values({
      leagueId: input.leagueId,
      userId: input.userId,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [leagueMember.leagueId, leagueMember.userId],
      set: { role: input.role, updatedAt: sql`now()` },
    });
  await recordAudit(db, {
    leagueId: input.leagueId,
    actorId: input.actorId,
    action: "operator.role",
    entityType: "user",
    entityId: input.userId,
    before: { role: before },
    after: { role: input.role },
  });
}

/**
 * The operator starts a league, with its first rule set. The first league
 * becomes the default. Run in a transaction.
 */
export async function createLeague(
  db: Db,
  input: NewLeagueInput & { actorId: UserId },
): Promise<Result<LeagueId, "slug_taken">> {
  const [taken] = await db
    .select({ id: league.id })
    .from(league)
    .where(eq(league.slug, input.slug));
  if (taken) return err("slug_taken");
  const [existing] = await db.select({ id: league.id }).from(league).limit(1);
  const [created] = await db
    .insert(league)
    .values({
      name: input.name,
      slug: input.slug,
      sport: input.sport,
      timezone: input.timeZone,
      minimumAge: input.minimumAge,
      branding: {
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
      },
      isDefault: !existing,
      createdBy: input.actorId,
    })
    .returning({ id: league.id });
  if (!created) throw new Error("The league was not created.");
  await db.insert(ruleSet).values({
    leagueId: created.id,
    name: input.ruleSet.name,
    innings: input.ruleSet.innings,
    timeLimitMinutes: input.ruleSet.timeLimitMinutes,
    createdBy: input.actorId,
  });
  await recordAudit(db, {
    leagueId: created.id,
    actorId: input.actorId,
    action: "operator.league_create",
    entityType: "league",
    entityId: created.id,
    after: {
      name: input.name,
      slug: input.slug,
      sport: input.sport,
      timeZone: input.timeZone,
      minimumAge: input.minimumAge,
    },
  });
  return ok(created.id);
}
