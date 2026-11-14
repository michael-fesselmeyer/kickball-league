import { desc, eq } from "drizzle-orm";
import type { Subject } from "@/domain/authz/permissions";
import type { LeagueId, UserId } from "@/domain/ids";
import { leaguesOf } from "../queries/leagues";
import type { Db } from "../queries/schedule";
import { loadSubject } from "../queries/subject";
import { event } from "../schema/event";
import { league, leagueMember } from "../schema/league";

/**
 * The league a test made: the newest one. Each test builds its world inside
 * a rolled-back transaction, so its league is newer than any the database
 * already holds (ADR 0048).
 */
export async function newestLeague(db: Db): Promise<LeagueId> {
  const [found] = await db
    .select({ id: league.id })
    .from(league)
    .orderBy(desc(league.createdAt), desc(league.id))
    .limit(1);
  if (!found) throw new Error("No league in the test database.");
  return found.id;
}

/** A person's league in a test: where they play or have a role, else the newest. */
export async function leagueFor(
  db: Db,
  userId: UserId | null,
): Promise<LeagueId> {
  const theirs = userId ? await leaguesOf(db, userId) : [];
  return theirs[0]?.id ?? newestLeague(db);
}

/** loadSubject, in the person's league. */
export async function subjectIn(
  db: Db,
  userId: UserId | null,
): Promise<Subject> {
  return loadSubject(db, userId, await leagueFor(db, userId));
}

/** The league of an event, by its slug (slugs are unique across leagues). */
export async function eventLeague(db: Db, slug: string): Promise<LeagueId> {
  const [found] = await db
    .select({ leagueId: event.leagueId })
    .from(event)
    .where(eq(event.slug, slug));
  return found?.leagueId ?? newestLeague(db);
}

/** Gives a person a role in a league: the test's newest league unless named. */
export async function grantRole(
  db: Db,
  userId: UserId,
  role: "admin" | "owner",
  leagueId?: LeagueId,
): Promise<void> {
  await db
    .insert(leagueMember)
    .values({ leagueId: leagueId ?? (await newestLeague(db)), userId, role })
    .onConflictDoUpdate({
      target: [leagueMember.leagueId, leagueMember.userId],
      set: { role },
    });
}

/** The test's league, made on the spot when the test built none. */
export async function ensureLeague(db: Db): Promise<LeagueId> {
  const [found] = await db
    .select({ id: league.id })
    .from(league)
    .orderBy(desc(league.createdAt), desc(league.id))
    .limit(1);
  if (found) return found.id;
  const [made] = await db
    .insert(league)
    .values({ name: "Test League", slug: "test-league" })
    .returning({ id: league.id });
  if (!made) throw new Error("No league.");
  return made.id;
}
