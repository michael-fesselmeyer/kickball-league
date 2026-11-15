import { aliasedTable, and, asc, eq, inArray, sql } from "drizzle-orm";
import type { GameId, LeagueId, SeasonId, UserId } from "@/domain/ids";
import {
  allowed,
  type AssignGame,
  type AssignRef,
  type Commitment,
} from "@/domain/referees/assign";
import { type PayInput, type PayoutMethod } from "@/domain/referees/pay";
import { err, ok, type Result } from "@/domain/result";
import { localDate } from "@/domain/books/ledger-csv";
import { user } from "../schema/auth";
import {
  field,
  game,
  refereeAssignment,
  scoreReport,
  slot,
} from "../schema/game";
import {
  refereeAvailability,
  refereePayout,
  refereePayRate,
  refereeProfile,
} from "../schema/referees";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { season as seasonTable } from "../schema/season";
import { recordAudit } from "./audit";
import { addExpense } from "./books";
import type { Db } from "./schedule";

/**
 * The ref pool, availability, the assigner's inputs and the pay sheet
 * (ADR 0053). Assignments themselves are `referee_assignment` rows, as
 * src/db/queries/referees.ts makes them by hand.
 */

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

// ---------------------------------------------------------------------------
// The pool

/** The league's refs, by name. */
export async function refereePool(db: Db, leagueId: LeagueId) {
  return db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(refereeProfile)
    .innerJoin(user, eq(refereeProfile.userId, user.id))
    .where(eq(refereeProfile.leagueId, leagueId))
    .orderBy(asc(user.name), asc(user.email));
}

/** Whether a person is in any league's ref pool. */
export async function inRefereePool(db: Db, userId: UserId) {
  const [found] = await db
    .select({ userId: refereeProfile.userId })
    .from(refereeProfile)
    .where(eq(refereeProfile.userId, userId))
    .limit(1);
  return found !== undefined;
}

export type PoolError = "no_account" | "already_in_pool";

/** Adds the person with this email to the pool. They need an account. */
export async function addToRefereePool(
  db: Db,
  input: { leagueId: LeagueId; email: string; actorId: UserId },
): Promise<Result<UserId, PoolError>> {
  const [person] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, input.email.trim().toLowerCase()));
  if (!person) return err("no_account");
  const added = await db
    .insert(refereeProfile)
    .values({
      leagueId: input.leagueId,
      userId: person.id,
      addedBy: input.actorId,
    })
    .onConflictDoNothing()
    .returning({ userId: refereeProfile.userId });
  if (added.length === 0) return err("already_in_pool");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "referee.pool_add",
    entityType: "user",
    leagueId: input.leagueId,
    entityId: person.id,
  });
  return ok(person.id);
}

/**
 * Takes someone out of the pool. Games they already referee stay theirs,
 * and so does their pay; they just aren't proposed any more.
 */
export async function removeFromRefereePool(
  db: Db,
  input: { leagueId: LeagueId; userId: UserId; actorId: UserId },
): Promise<void> {
  const removed = await db
    .delete(refereeProfile)
    .where(
      and(
        eq(refereeProfile.leagueId, input.leagueId),
        eq(refereeProfile.userId, input.userId),
      ),
    )
    .returning({ userId: refereeProfile.userId });
  if (removed.length > 0)
    await recordAudit(db, {
      actorId: input.actorId,
      action: "referee.pool_remove",
      entityType: "user",
      leagueId: input.leagueId,
      entityId: input.userId,
    });
}

// ---------------------------------------------------------------------------
// Availability

/** The league a season belongs to, or null if there's no such season. */
export async function leagueOfSeason(db: Db, seasonId: SeasonId) {
  const [found] = await db
    .select({ leagueId: seasonTable.leagueId })
    .from(seasonTable)
    .where(eq(seasonTable.id, seasonId));
  return found?.leagueId ?? null;
}

/** A season's slot start times with games on them, soonest first. */
export async function seasonGameTimes(db: Db, seasonId: SeasonId) {
  const rows = await db
    .selectDistinct({ startsAt: slot.startsAt })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(
      and(
        eq(game.seasonId, seasonId),
        eq(slot.status, "open"),
        sql`${game.status} not in ('cancelled', 'final', 'forfeit')`,
      ),
    )
    .orderBy(asc(slot.startsAt));
  return rows.map((r) => r.startsAt);
}

/** The start times a ref said they can work in a season. */
export async function availabilityOf(
  db: Db,
  seasonId: SeasonId,
  userId: UserId,
): Promise<Date[]> {
  const rows = await db
    .select({ startsAt: refereeAvailability.startsAt })
    .from(refereeAvailability)
    .where(
      and(
        eq(refereeAvailability.seasonId, seasonId),
        eq(refereeAvailability.userId, userId),
      ),
    )
    .orderBy(asc(refereeAvailability.startsAt));
  return rows.map((r) => r.startsAt);
}

/**
 * Saves a ref's answer for the times on their form: the ones ticked are
 * kept, the rest of those times are cleared. Times not on the form, such
 * as ones already played, stay as they were.
 */
export async function setAvailability(
  db: Db,
  input: {
    seasonId: SeasonId;
    userId: UserId;
    shown: readonly Date[];
    ticked: readonly Date[];
  },
): Promise<void> {
  const shown = new Set(input.shown.map((d) => d.getTime()));
  const ticked = input.ticked.filter((d) => shown.has(d.getTime()));
  if (shown.size > 0)
    await db
      .delete(refereeAvailability)
      .where(
        and(
          eq(refereeAvailability.seasonId, input.seasonId),
          eq(refereeAvailability.userId, input.userId),
          inArray(refereeAvailability.startsAt, [...input.shown]),
        ),
      );
  if (ticked.length > 0)
    await db
      .insert(refereeAvailability)
      .values(
        ticked.map((startsAt) => ({
          seasonId: input.seasonId,
          userId: input.userId,
          startsAt,
        })),
      )
      .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// The assigner's inputs

export type StaffableGame = AssignGame & {
  fieldName: string;
  teamAName: string;
  teamBName: string;
};

/**
 * Everything the assigner needs for a season, or for one of its days
 * (`YYYY-MM-DD` in the league's time zone): the games still without a
 * ref, the pool with availability and teams, and what each ref is already
 * doing that season. Five reads, whatever the size of the pool.
 */
export async function assignerInputs(
  db: Db,
  input: {
    seasonId: SeasonId;
    leagueId: LeagueId;
    timeZone: string;
    day: string | null;
    now: Date;
  },
): Promise<{
  games: StaffableGame[];
  refs: (AssignRef & { name: string })[];
  commitments: Commitment[];
}> {
  const [season, pool, availability, rosters] = await Promise.all([
    db
      .select({
        id: game.id,
        status: game.status,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        fieldId: slot.fieldId,
        fieldName: field.name,
        teamAId: game.teamAId,
        teamBId: game.teamBId,
        teamAName: teamA.name,
        teamBName: teamB.name,
        refereeId: sql<UserId | null>`(
          select ${refereeAssignment.userId} from ${refereeAssignment}
          where ${refereeAssignment.gameId} = ${game.id}
            and ${refereeAssignment.status} in ('offered', 'accepted')
          limit 1
        )`,
      })
      .from(game)
      .innerJoin(slot, eq(game.slotId, slot.id))
      .innerJoin(field, eq(slot.fieldId, field.id))
      .innerJoin(entryA, eq(game.teamAId, entryA.id))
      .innerJoin(teamA, eq(entryA.teamId, teamA.id))
      .innerJoin(entryB, eq(game.teamBId, entryB.id))
      .innerJoin(teamB, eq(entryB.teamId, teamB.id))
      .where(
        and(
          eq(game.seasonId, input.seasonId),
          sql`${game.status} <> 'cancelled'`,
        ),
      )
      .orderBy(asc(slot.startsAt), asc(field.name)),
    refereePool(db, input.leagueId),
    db
      .select({
        userId: refereeAvailability.userId,
        startsAt: refereeAvailability.startsAt,
      })
      .from(refereeAvailability)
      .where(eq(refereeAvailability.seasonId, input.seasonId)),
    db
      .select({
        userId: registration.userId,
        teamSeasonId: rosterMembership.teamSeasonId,
      })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .where(
        and(
          eq(teamSeason.seasonId, input.seasonId),
          eq(rosterMembership.status, "active"),
        ),
      ),
  ]);
  const span = (g: (typeof season)[number]) => ({
    startsAt: g.startsAt.getTime(),
    endsAt: g.endsAt.getTime(),
    fieldId: g.fieldId,
  });
  const refs = pool.map((p) => ({
    id: p.userId,
    name: p.name || p.email,
    available: new Set(
      availability
        .filter((a) => a.userId === p.userId)
        .map((a) => a.startsAt.getTime()),
    ),
    teamSeasonIds: new Set(
      rosters.filter((r) => r.userId === p.userId).map((r) => r.teamSeasonId),
    ),
  }));
  const commitments: Commitment[] = refs.flatMap((r) =>
    season.flatMap((g) => [
      ...(g.refereeId === r.id
        ? [{ refId: r.id, ...span(g), counts: true }]
        : []),
      ...(r.teamSeasonIds.has(g.teamAId) || r.teamSeasonIds.has(g.teamBId)
        ? [{ refId: r.id, ...span(g), counts: false }]
        : []),
    ]),
  );
  const games = season
    .filter(
      (g) =>
        g.refereeId === null &&
        (g.status === "scheduled" || g.status === "postponed") &&
        g.startsAt > input.now &&
        (input.day === null ||
          localDate(g.startsAt, input.timeZone) === input.day),
    )
    .map((g): StaffableGame => ({
      id: g.id,
      ...span(g),
      teamSeasonIds: [g.teamAId, g.teamBId],
      fieldName: g.fieldName,
      teamAName: g.teamAName,
      teamBName: g.teamBName,
    }));
  return { games, refs, commitments };
}

/** The game days with games still to staff, as `YYYY-MM-DD`. */
export function staffDays(
  games: readonly StaffableGame[],
  timeZone: string,
): string[] {
  return [
    ...new Set(games.map((g) => localDate(new Date(g.startsAt), timeZone))),
  ];
}

/**
 * Why a pair wasn't assigned: the game no longer waits for a ref (it has
 * one, started or was called off), the ref left the pool, the ref plays
 * in it or is busy then, or another pair or admin took the game first.
 */
export const SKIP_REASONS = [
  "closed",
  "not_in_pool",
  "clash",
  "taken",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type AcceptOutcome = {
  assigned: number;
  skipped: number;
  /** The most common reason among the skipped, or null if none was. */
  why: SkipReason | null;
};

/**
 * Makes accepted proposals, or an admin's pick, real. Each pair is checked
 * again against the season as it is now, so a game someone staffed
 * meanwhile, a ref who left the pool, a ref on one of the teams, or a ref
 * who would be at two games at once is skipped rather than assigned.
 * Availability and back-to-back fields are the assigner's preferences; an
 * admin picking by hand may overrule them.
 *
 * Two admins accepting the same game at once can't both win: the second
 * insert meets the one-live-assignment index and is skipped.
 */
export async function acceptProposals(
  db: Db,
  input: {
    seasonId: SeasonId;
    leagueId: LeagueId;
    pairs: readonly { gameId: GameId; userId: UserId }[];
    actorId: UserId;
  },
): Promise<AcceptOutcome> {
  if (input.pairs.length === 0) return { assigned: 0, skipped: 0, why: null };
  const now = new Date();
  const season = await assignerInputs(db, {
    seasonId: input.seasonId,
    leagueId: input.leagueId,
    timeZone: "UTC",
    day: null,
    now,
  });
  const gameOf = new Map(season.games.map((g) => [g.id, g]));
  const refOf = new Map(season.refs.map((r) => [r.id, r]));
  const busy = Map.groupBy(season.commitments, (c) => c.refId);
  const taken = new Set<string>();
  const reasons: SkipReason[] = [];
  const skip = (why: SkipReason) => {
    reasons.push(why);
    return false;
  };
  const rows = input.pairs.filter((p) => {
    const g = gameOf.get(p.gameId);
    const r = refOf.get(p.userId);
    if (!g) return skip("closed");
    if (!r) return skip("not_in_pool");
    if (taken.has(g.id)) return skip("taken");
    const theirs: Omit<Commitment, "refId" | "counts">[] = busy.get(r.id) ?? [];
    if (!allowed(r, g, theirs)) return skip("clash");
    taken.add(g.id);
    busy.set(r.id, [
      ...(busy.get(r.id) ?? []),
      { ...g, refId: r.id, counts: true },
    ]);
    return true;
  });
  const inserted =
    rows.length === 0
      ? []
      : await db
          .insert(refereeAssignment)
          .values(
            rows.map((p) => ({
              gameId: p.gameId,
              userId: p.userId,
              status: "accepted" as const,
              respondedAt: now,
              createdBy: input.actorId,
            })),
          )
          .onConflictDoNothing()
          .returning({
            gameId: refereeAssignment.gameId,
            userId: refereeAssignment.userId,
          });
  for (const p of inserted)
    await recordAudit(db, {
      actorId: input.actorId,
      action: "referee.assign",
      entityType: "game",
      entityId: p.gameId,
      after: { userId: p.userId, proposed: true },
    });
  // An insert the one-live-assignment index refused: another admin won.
  for (let i = inserted.length; i < rows.length; i++) reasons.push("taken");
  const most = SKIP_REASONS.map((why) => ({
    why,
    n: reasons.filter((r) => r === why).length,
  })).sort((a, b) => b.n - a.n)[0];
  return {
    assigned: inserted.length,
    skipped: input.pairs.length - inserted.length,
    why: most && most.n > 0 ? most.why : null,
  };
}

// ---------------------------------------------------------------------------
// Pay

/** The season's per-game fee in cents, or null when none is set. */
export async function payRate(db: Db, seasonId: SeasonId) {
  const [found] = await db
    .select({ feeCents: refereePayRate.feeCents })
    .from(refereePayRate)
    .where(eq(refereePayRate.seasonId, seasonId));
  return found?.feeCents ?? null;
}

export async function setPayRate(
  db: Db,
  input: { seasonId: SeasonId; feeCents: number; actorId: UserId },
): Promise<void> {
  const before = await payRate(db, input.seasonId);
  await db
    .insert(refereePayRate)
    .values({
      seasonId: input.seasonId,
      feeCents: input.feeCents,
      updatedBy: input.actorId,
    })
    .onConflictDoUpdate({
      target: refereePayRate.seasonId,
      set: {
        feeCents: input.feeCents,
        updatedBy: input.actorId,
        updatedAt: new Date(),
      },
    });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "referee.pay_rate",
    entityType: "season",
    entityId: input.seasonId,
    before: { feeCents: before },
    after: { feeCents: input.feeCents },
  });
}

/**
 * A game a ref worked: theirs, and they checked in for it or reported its
 * score as its ref. One that was cancelled or reassigned doesn't count.
 */
const worked = sql`(
  ${refereeAssignment.status} in ('accepted', 'completed')
  and (
    ${refereeAssignment.checkedInAt} is not null
    or exists (
      select 1 from ${scoreReport}
      where ${scoreReport.gameId} = ${refereeAssignment.gameId}
        and ${scoreReport.reportedBy} = ${refereeAssignment.userId}
        and ${scoreReport.reporterRole} = 'referee'
    )
  )
)`;

/**
 * Each ref's games worked and payouts in a season: everyone in the pool,
 * and anyone else who worked or was paid. Two grouped reads.
 */
export async function payInputs(
  db: Db,
  input: { seasonId: SeasonId; leagueId: LeagueId; userId?: UserId },
): Promise<PayInput[]> {
  const mine = input.userId;
  const [games, payouts, pool] = await Promise.all([
    db
      .select({
        userId: refereeAssignment.userId,
        name: user.name,
        email: user.email,
        gamesWorked: sql<number>`count(*) filter (where ${worked})::int`,
      })
      .from(refereeAssignment)
      .innerJoin(game, eq(refereeAssignment.gameId, game.id))
      .innerJoin(user, eq(refereeAssignment.userId, user.id))
      .where(
        and(
          eq(game.seasonId, input.seasonId),
          mine ? eq(refereeAssignment.userId, mine) : undefined,
        ),
      )
      .groupBy(refereeAssignment.userId, user.name, user.email),
    db
      .select({
        userId: refereePayout.userId,
        name: user.name,
        email: user.email,
        paidCents: sql<number>`sum(${refereePayout.amountCents})::int`,
      })
      .from(refereePayout)
      .innerJoin(user, eq(refereePayout.userId, user.id))
      .where(
        and(
          eq(refereePayout.seasonId, input.seasonId),
          mine ? eq(refereePayout.userId, mine) : undefined,
        ),
      )
      .groupBy(refereePayout.userId, user.name, user.email),
    mine ? Promise.resolve([]) : refereePool(db, input.leagueId),
  ]);
  const rows = new Map<string, PayInput>();
  const row = (p: { userId: string; name: string; email: string }) => {
    const found = rows.get(p.userId);
    if (found) return found;
    const created = {
      userId: p.userId,
      name: p.name || p.email,
      gamesWorked: 0,
      paidCents: 0,
    };
    rows.set(p.userId, created);
    return created;
  };
  for (const p of pool) row(p);
  for (const g of games) row(g).gamesWorked = g.gamesWorked;
  for (const p of payouts) row(p).paidCents = p.paidCents;
  return [...rows.values()].filter(
    (r) =>
      pool.some((p) => p.userId === r.userId) ||
      r.gamesWorked > 0 ||
      r.paidCents > 0,
  );
}

/** A ref's own games in a season, with whether each counts as worked. */
export async function myRefereeGames(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId },
) {
  return db
    .select({
      gameId: game.id,
      startsAt: slot.startsAt,
      fieldName: field.name,
      teamAName: teamA.name,
      teamBName: teamB.name,
      worked: sql<boolean>`${worked}`,
    })
    .from(refereeAssignment)
    .innerJoin(game, eq(refereeAssignment.gameId, game.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .where(
      and(
        eq(game.seasonId, input.seasonId),
        eq(refereeAssignment.userId, input.userId),
        inArray(refereeAssignment.status, ["accepted", "completed"]),
      ),
    )
    .orderBy(asc(slot.startsAt));
}

/** A ref's payouts in a season, newest first. */
export async function payoutsOf(
  db: Db,
  input: { seasonId: SeasonId; userId: UserId },
) {
  return db
    .select({
      id: refereePayout.id,
      amountCents: refereePayout.amountCents,
      method: refereePayout.method,
      paidOn: refereePayout.paidOn,
    })
    .from(refereePayout)
    .where(
      and(
        eq(refereePayout.seasonId, input.seasonId),
        eq(refereePayout.userId, input.userId),
      ),
    )
    .orderBy(
      sql`${refereePayout.paidOn} desc, ${refereePayout.createdAt} desc`,
    );
}

/**
 * Records money paid to a ref, and adds it to the season's books as a
 * "Refs" expense. The expense note names the method, not the ref: the
 * books' tax export names nobody.
 *
 * `paidBeforeCents` is what the sheet showed as already paid. If it no
 * longer matches, someone recorded a payment meanwhile (or the same tap
 * arrived twice), so nothing is recorded and the admin sees the sheet
 * again. A lock per ref and season makes that check hold under races.
 */
export async function recordPayout(
  db: Db,
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    userId: UserId;
    amountCents: number;
    method: PayoutMethod;
    paidOn: string;
    paidBeforeCents: number;
    actorId: UserId;
  },
): Promise<Result<void, "unknown_season" | "unknown_ref" | "stale">> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`referee-payout:${input.seasonId}:${input.userId}`}))`,
  );
  const [[pooled], [reffed], [paid]] = await Promise.all([
    db
      .select({ userId: refereeProfile.userId })
      .from(refereeProfile)
      .where(
        and(
          eq(refereeProfile.leagueId, input.leagueId),
          eq(refereeProfile.userId, input.userId),
        ),
      ),
    db
      .select({ id: refereeAssignment.id })
      .from(refereeAssignment)
      .innerJoin(game, eq(refereeAssignment.gameId, game.id))
      .where(
        and(
          eq(game.seasonId, input.seasonId),
          eq(refereeAssignment.userId, input.userId),
        ),
      )
      .limit(1),
    db
      .select({
        cents: sql<number>`coalesce(sum(${refereePayout.amountCents}), 0)::int`,
      })
      .from(refereePayout)
      .where(
        and(
          eq(refereePayout.seasonId, input.seasonId),
          eq(refereePayout.userId, input.userId),
        ),
      ),
  ]);
  if (!pooled && !reffed) return err("unknown_ref");
  if ((paid?.cents ?? 0) !== input.paidBeforeCents) return err("stale");
  const added = await addExpense(
    db,
    {
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      spentOn: input.paidOn,
      amountCents: input.amountCents,
      category: "refs",
      note: `Ref pay (${input.method === "venmo" ? "Venmo" : "cash"})`,
      receipt: null,
    },
    input.actorId,
  );
  if (!added.ok) return err("unknown_season");
  await db.insert(refereePayout).values({
    seasonId: input.seasonId,
    userId: input.userId,
    amountCents: input.amountCents,
    method: input.method,
    paidOn: input.paidOn,
    paidBy: input.actorId,
    expenseId: added.value,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "referee.payout",
    entityType: "user",
    leagueId: input.leagueId,
    entityId: input.userId,
    after: {
      seasonId: input.seasonId,
      amountCents: input.amountCents,
      method: input.method,
      expenseId: added.value,
    },
  });
  return ok(undefined);
}

/**
 * The seasons a ref's page shows: ones with games still to play, and ones
 * they worked or were paid in. Newest first.
 */
export async function refereeSeasons(
  db: Db,
  input: { leagueId: LeagueId; userId: UserId; now: Date },
) {
  return db
    .select({ id: seasonTable.id, name: seasonTable.name })
    .from(seasonTable)
    .where(
      and(
        eq(seasonTable.leagueId, input.leagueId),
        sql`(
          exists (
            select 1 from ${game} join ${slot} on ${slot.id} = ${game.slotId}
            where ${game.seasonId} = ${seasonTable.id}
              and ${slot.startsAt} > ${input.now}
              and ${game.status} in ('scheduled', 'postponed')
          )
          or exists (
            select 1 from ${refereeAssignment}
            join ${game} on ${game.id} = ${refereeAssignment.gameId}
            where ${game.seasonId} = ${seasonTable.id}
              and ${refereeAssignment.userId} = ${input.userId}
          )
          or exists (
            select 1 from ${refereePayout}
            where ${refereePayout.seasonId} = ${seasonTable.id}
              and ${refereePayout.userId} = ${input.userId}
          )
        )`,
      ),
    )
    .orderBy(sql`${seasonTable.startsOn} desc`);
}
