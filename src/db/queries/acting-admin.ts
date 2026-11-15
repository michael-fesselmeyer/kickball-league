import { and, asc, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  ACTING_POWER_LABELS,
  type ActingPower,
  checkGrant,
  type GrantError,
  grantIsActive,
  isActingPower,
  powersAt,
} from "@/domain/authz/acting-admin";
import type { ActingAdminId, LeagueId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { actingAdmin } from "../schema/acting-admin";
import { user } from "../schema/auth";
import { league, leagueMember } from "../schema/league";
import { profile } from "../schema/profile";
import { recordAudit } from "./audit";
import { leagueUsersWithRole } from "./leagues";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * Acting admin handovers (issue #468). The rules are in
 * src/domain/authz/acting-admin.ts and are applied by `can`; this file
 * writes the grants, audits every change, and queues the start and end
 * notices. A grant gives nothing outside its dates, so expiry needs no job.
 */

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

/** The powers a person holds in a league at `now`, all grants together. */
export async function actingPowersOf(
  db: Db,
  userId: UserId,
  leagueId: LeagueId,
  now: Date,
): Promise<ActingPower[]> {
  const grants = await db
    .select({
      powers: actingAdmin.powers,
      startsAt: actingAdmin.startsAt,
      endsAt: actingAdmin.endsAt,
      endedAt: actingAdmin.endedAt,
    })
    .from(actingAdmin)
    .where(
      and(
        eq(actingAdmin.userId, userId),
        eq(actingAdmin.leagueId, leagueId),
        isNull(actingAdmin.endedAt),
        lte(actingAdmin.startsAt, now),
        sql`${actingAdmin.endsAt} > ${now}`,
      ),
    );
  return powersAt(grants, now);
}

export type GrantInput = {
  leagueId: LeagueId;
  userId: UserId;
  powers: readonly string[];
  startsAt: Date;
  endsAt: Date;
  /** An owner; the caller has checked admins.manage. */
  actorId: UserId;
  now: Date;
};

export type GrantRefusal = GrantError | "not_a_player" | "already_staff";

/** Hands powers to a player for a date range. Run in a transaction. */
export async function grantActingAdmin(
  db: Db,
  input: GrantInput,
): Promise<Result<{ id: ActingAdminId }, GrantRefusal>> {
  const invalid = checkGrant(input, input.now);
  if (invalid) return err(invalid);
  const [person] = await db
    .select({ role: leagueMember.role, userId: profile.userId })
    .from(profile)
    .leftJoin(
      leagueMember,
      and(
        eq(leagueMember.userId, profile.userId),
        eq(leagueMember.leagueId, input.leagueId),
      ),
    )
    .where(eq(profile.userId, input.userId));
  if (!person) return err("not_a_player");
  if (person.role === "admin" || person.role === "owner")
    return err("already_staff");
  const powers = [...new Set(input.powers.filter(isActingPower))];
  const [created] = await db
    .insert(actingAdmin)
    .values({
      leagueId: input.leagueId,
      userId: input.userId,
      powers,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      grantedBy: input.actorId,
    })
    .returning({ id: actingAdmin.id });
  if (!created) throw new Error("The handover was not saved.");
  await recordAudit(db, {
    leagueId: input.leagueId,
    actorId: input.actorId,
    action: "acting_admin.grant",
    entityType: "actingAdmin",
    entityId: created.id,
    after: {
      userId: input.userId,
      powers,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
    },
  });
  return ok({ id: created.id });
}

/** Ends a handover now, whether it is running or still to come. Run in a transaction. */
export async function endActingAdmin(
  db: Db,
  input: {
    id: ActingAdminId;
    leagueId: LeagueId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_found" | "already_over">> {
  const [row] = await db
    .select()
    .from(actingAdmin)
    .where(
      and(
        eq(actingAdmin.id, input.id),
        eq(actingAdmin.leagueId, input.leagueId),
      ),
    )
    .for("update");
  if (!row) return err("not_found");
  if (row.endedAt !== null || row.endsAt <= input.now)
    return err("already_over");
  await db
    .update(actingAdmin)
    .set({ endedAt: input.now })
    .where(eq(actingAdmin.id, input.id));
  await recordAudit(db, {
    leagueId: input.leagueId,
    actorId: input.actorId,
    action: "acting_admin.end",
    entityType: "actingAdmin",
    entityId: input.id,
    before: { endsAt: row.endsAt.toISOString() },
    after: { endedAt: input.now.toISOString(), userId: row.userId },
  });
  return ok(undefined);
}

export type ActingAdminRow = {
  id: ActingAdminId;
  userId: UserId;
  name: string;
  powers: string[];
  startsAt: Date;
  endsAt: Date;
  endedAt: Date | null;
  status: "upcoming" | "active" | "ended";
};

/** A league's handovers, running and upcoming first, then the latest ended. */
export async function listActingAdmins(
  db: Db,
  leagueId: LeagueId,
  now: Date,
  endedLimit = 10,
): Promise<ActingAdminRow[]> {
  const rows = await db
    .select({
      id: actingAdmin.id,
      userId: actingAdmin.userId,
      name: shortName,
      powers: actingAdmin.powers,
      startsAt: actingAdmin.startsAt,
      endsAt: actingAdmin.endsAt,
      endedAt: actingAdmin.endedAt,
    })
    .from(actingAdmin)
    .innerJoin(user, eq(actingAdmin.userId, user.id))
    .leftJoin(profile, eq(profile.userId, actingAdmin.userId))
    .where(eq(actingAdmin.leagueId, leagueId))
    .orderBy(desc(actingAdmin.startsAt));
  const shaped = rows.map((r) => ({
    ...r,
    status: statusOf(r, now),
  }));
  const live = shaped
    .filter((r) => r.status !== "ended")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const ended = shaped.filter((r) => r.status === "ended").slice(0, endedLimit);
  return [...live, ...ended];
}

function statusOf(
  r: { startsAt: Date; endsAt: Date; endedAt: Date | null },
  now: Date,
): ActingAdminRow["status"] {
  if (r.endedAt !== null || r.endsAt <= now) return "ended";
  return grantIsActive({ ...r, powers: [] }, now) ? "active" : "upcoming";
}

/** Players an owner may pick: league members below admin. */
export async function handoverCandidates(db: Db, leagueId: LeagueId) {
  return db
    .select({ userId: leagueMember.userId, name: shortName })
    .from(leagueMember)
    .innerJoin(user, eq(leagueMember.userId, user.id))
    .leftJoin(profile, eq(profile.userId, leagueMember.userId))
    .where(
      and(
        eq(leagueMember.leagueId, leagueId),
        eq(leagueMember.role, "player"),
        sql`${user.email} not like 'deleted-%@deleted.invalid'`,
      ),
    )
    .orderBy(asc(shortName));
}

const longWhen = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);

/**
 * Queues the start and end notices that are due, to the acting admin and
 * every owner, and marks them sent in the same transaction. A handover
 * ended before it began sends nothing. Safe to run twice. Returns how many
 * messages were queued.
 */
export async function queueActingAdminNotices(
  db: Db,
  now: Date,
): Promise<number> {
  // Revoked before it began: nobody was ever acting, so nobody is told.
  await db
    .update(actingAdmin)
    .set({ startNoticeAt: now, endNoticeAt: now })
    .where(
      and(
        isNull(actingAdmin.startNoticeAt),
        isNotNull(actingAdmin.endedAt),
        sql`${actingAdmin.endedAt} <= ${actingAdmin.startsAt}`,
      ),
    );
  const starting = await db
    .update(actingAdmin)
    .set({ startNoticeAt: now })
    .where(
      and(
        isNull(actingAdmin.startNoticeAt),
        lte(actingAdmin.startsAt, now),
        sql`${actingAdmin.endsAt} > ${now}`,
        isNull(actingAdmin.endedAt),
      ),
    )
    .returning();
  const ending = await db
    .update(actingAdmin)
    .set({
      endNoticeAt: now,
      startNoticeAt: sql`coalesce(${actingAdmin.startNoticeAt}, ${now})`,
    })
    .where(
      and(
        isNull(actingAdmin.endNoticeAt),
        isNotNull(actingAdmin.startNoticeAt),
        sql`(${actingAdmin.endedAt} is not null or ${actingAdmin.endsAt} <= ${now})`,
      ),
    )
    .returning();
  const messages: OutboxMessage[] = [];
  const notices = [
    ...starting.map((g) => ({ g, kind: "started" as const })),
    ...ending.map((g) => ({
      g,
      kind: g.endedAt !== null ? ("ended_early" as const) : ("ended" as const),
    })),
  ];
  const owners = new Map<LeagueId, UserId[]>();
  const zones = new Map<LeagueId, string>();
  for (const { g, kind } of notices) {
    const [who] = await db
      .select({ name: shortName })
      .from(user)
      .leftJoin(profile, eq(profile.userId, user.id))
      .where(eq(user.id, g.userId));
    let leagueOwners = owners.get(g.leagueId);
    if (!leagueOwners) {
      leagueOwners = await leagueUsersWithRole(db, g.leagueId, ["owner"]);
      owners.set(g.leagueId, leagueOwners);
    }
    let tz = zones.get(g.leagueId);
    if (!tz) {
      const [l] = await db
        .select({ tz: league.timezone })
        .from(league)
        .where(eq(league.id, g.leagueId));
      tz = l?.tz ?? "America/New_York";
      zones.set(g.leagueId, tz);
    }
    const powers = g.powers
      .filter(isActingPower)
      .map((p) => ACTING_POWER_LABELS[p].label);
    for (const userId of new Set([g.userId, ...leagueOwners]))
      messages.push({
        userId,
        template: "acting_admin",
        topic: "operations",
        payload: {
          kind,
          person: who?.name ?? "A player",
          toActing: userId === g.userId,
          powers: powers.length > 0 ? powers : ["None"],
          starts: longWhen(g.startsAt, tz),
          ends: longWhen(g.endedAt ?? g.endsAt, tz),
        },
        dedupeKey: `acting_admin/${g.id}/${kind}/${userId}`,
      });
  }
  return messages.length === 0 ? 0 : enqueueMessages(db, messages);
}

/**
 * Ends every handover of a person whose account is being deleted, so no
 * access outlives the account. Run inside the deletion's transaction.
 */
export async function endActingAdminsOf(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<void> {
  await db
    .update(actingAdmin)
    .set({ endedAt: now })
    .where(
      and(
        eq(actingAdmin.userId, userId),
        isNull(actingAdmin.endedAt),
        sql`${actingAdmin.endsAt} > ${now}`,
      ),
    );
}
