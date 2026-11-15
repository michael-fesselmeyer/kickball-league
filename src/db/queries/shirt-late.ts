import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type {
  LeagueId,
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  summarizeWaiting,
  type WaitingPlayer,
  type WaitingSummary,
} from "@/domain/shirts/late";
import type { ShirtSize } from "@/domain/shirts/summary";
import { user } from "../schema/auth";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { shirtSpare } from "../schema/shirt-late";
import { seasonShirts } from "../schema/shirts";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";
import { ON_ORDER } from "./shirt-order";

/**
 * Shirts for players who join after a season's order (docs/data-model.md,
 * section 2.1): the league-wide waiting list, the spare stock, the batch
 * reorder, and a team's choice to wear its own shirts. The writes record
 * their audit row in the same transaction; callers run them inside one.
 */

/** The seasons whose shirt order is placed or received: joining now is late. */
const ORDERED_SEASON = inArray(seasonShirts.status, ["placed", "received"]);

export type WaitingRow = WaitingPlayer & {
  registrationId: RegistrationId;
  seasonId: SeasonId;
  seasonName: string;
  name: string;
  teamSeasonId: TeamSeasonId;
};

/**
 * Players on a team of a current or coming season whose shirt was not in
 * that season's order: joined after it was placed, shirt not ordered, size
 * on their profile. Teams that wear their own shirts, free agents without a
 * team, players with no size and cancelled or waitlisted sign-ups are left
 * out. One query for every season of the league.
 */
export async function waitingRows(
  db: Db,
  leagueId: LeagueId,
  today: string,
): Promise<WaitingRow[]> {
  const rows = await db
    .select({
      registrationId: registration.id,
      seasonId: season.id,
      seasonName: season.name,
      teamSeasonId: teamSeason.id,
      teamName: team.name,
      size: profile.shirtSize,
      first: profile.firstName,
      last: profile.lastName,
      account: user.name,
    })
    .from(registration)
    .innerJoin(season, eq(season.id, registration.seasonId))
    .innerJoin(seasonShirts, eq(seasonShirts.seasonId, season.id))
    .innerJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .innerJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .innerJoin(user, eq(user.id, registration.userId))
    .innerJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(season.leagueId, leagueId),
        gte(season.endsOn, today),
        ORDERED_SEASON,
        eq(registration.shirtStatus, "none"),
        inArray(registration.status, [...ON_ORDER]),
        eq(teamSeason.ownShirts, false),
        ne(teamSeason.status, "withdrawn"),
        sql`${profile.shirtSize} is not null`,
      ),
    )
    .orderBy(asc(team.name), asc(registration.createdAt));
  return rows.flatMap((r) =>
    r.size === null
      ? []
      : [
          {
            registrationId: r.registrationId,
            seasonId: r.seasonId,
            seasonName: r.seasonName,
            teamSeasonId: r.teamSeasonId,
            teamName: r.teamName,
            size: r.size,
            name: [r.first, r.last].filter(Boolean).join(" ") || r.account,
          },
        ],
  );
}

/** Spare shirts in stock by size: every size with any. */
export async function spareStock(
  db: Db,
  leagueId: LeagueId,
): Promise<Partial<Record<ShirtSize, number>>> {
  const rows = await db
    .select({
      size: shirtSpare.size,
      stock: sql<number>`sum(${shirtSpare.delta})`.mapWith(Number),
    })
    .from(shirtSpare)
    .where(eq(shirtSpare.leagueId, leagueId))
    .groupBy(shirtSpare.size);
  const stock: Partial<Record<ShirtSize, number>> = {};
  for (const r of rows) if (r.stock > 0) stock[r.size] = r.stock;
  return stock;
}

/** The waiting list, the spare stock and the batch summary, in parallel. */
export async function lateShirtBoard(
  db: Db,
  leagueId: LeagueId,
  today: string,
): Promise<{
  rows: WaitingRow[];
  stock: Partial<Record<ShirtSize, number>>;
  summary: WaitingSummary;
}> {
  const [rows, stock] = await Promise.all([
    waitingRows(db, leagueId, today),
    spareStock(db, leagueId),
  ]);
  return { rows, stock, summary: summarizeWaiting(rows, stock) };
}

/** Serializes spare-stock writes for a league. */
const lockStock = (db: Db, leagueId: LeagueId) =>
  db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`shirt_spare:${leagueId}`}))`,
  );

/** Logs spare shirts left over from an earlier order. */
export async function logSpare(
  db: Db,
  input: {
    leagueId: LeagueId;
    size: ShirtSize;
    quantity: number;
    note: string | null;
    actorId: UserId;
  },
): Promise<void> {
  await lockStock(db, input.leagueId);
  await db.insert(shirtSpare).values({
    leagueId: input.leagueId,
    size: input.size,
    delta: input.quantity,
    note: input.note,
    actorId: input.actorId,
  });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.spare_log",
    entityType: "league",
    entityId: input.leagueId,
    leagueId: input.leagueId,
    after: { size: input.size, quantity: input.quantity },
  });
}

export type HandOutError =
  | "not_found"
  | "has_shirt"
  | "no_size"
  | "none_in_stock";

/**
 * Hands a spare shirt to a player: one fewer in stock, and the player's
 * shirt is received. The stock is checked after taking the league's lock,
 * so two hand-outs of the last spare cannot both succeed.
 */
export async function handOutSpare(
  db: Db,
  input: { leagueId: LeagueId; registrationId: RegistrationId; actorId: UserId },
): Promise<Result<{ size: ShirtSize }, HandOutError>> {
  await lockStock(db, input.leagueId);
  const [row] = await db
    .select({
      status: registration.shirtStatus,
      size: profile.shirtSize,
    })
    .from(registration)
    .innerJoin(season, eq(season.id, registration.seasonId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(registration.id, input.registrationId),
        eq(season.leagueId, input.leagueId),
      ),
    )
    .for("update", { of: registration });
  if (!row) return err("not_found");
  if (row.status !== "none") return err("has_shirt");
  if (row.size === null) return err("no_size");
  const stock = (await spareStock(db, input.leagueId))[row.size] ?? 0;
  if (stock < 1) return err("none_in_stock");
  await db.insert(shirtSpare).values({
    leagueId: input.leagueId,
    size: row.size,
    delta: -1,
    registrationId: input.registrationId,
    actorId: input.actorId,
  });
  await db
    .update(registration)
    .set({ shirtStatus: "received" })
    .where(eq(registration.id, input.registrationId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.spare_hand_out",
    entityType: "registration",
    entityId: input.registrationId,
    before: { shirtStatus: "none" },
    after: { shirtStatus: "received", size: row.size },
  });
  return ok({ size: row.size });
}

/**
 * The batch reorder was placed: everyone on the waiting list is marked
 * ordered. Hand out the spares first; whoever is still waiting is in the
 * batch.
 */
export async function markBatchOrdered(
  db: Db,
  input: { leagueId: LeagueId; actorId: UserId; today: string },
): Promise<number> {
  const rows = await waitingRows(db, input.leagueId, input.today);
  if (rows.length === 0) return 0;
  await db
    .update(registration)
    .set({ shirtStatus: "ordered" })
    .where(
      and(
        inArray(
          registration.id,
          rows.map((r) => r.registrationId),
        ),
        eq(registration.shirtStatus, "none"),
      ),
    );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.batch_order",
    entityType: "league",
    entityId: input.leagueId,
    leagueId: input.leagueId,
    after: { players: rows.length },
  });
  return rows.length;
}

/**
 * The batch arrived: shirts marked ordered in a season whose own order is
 * already received are marked received. Shirts in an order still on its
 * way are left to that order.
 */
export async function receiveBatch(
  db: Db,
  input: { leagueId: LeagueId; actorId: UserId },
): Promise<number> {
  const received = await db
    .update(registration)
    .set({ shirtStatus: "received" })
    .where(
      and(
        eq(registration.shirtStatus, "ordered"),
        inArray(
          registration.seasonId,
          db
            .select({ id: season.id })
            .from(season)
            .innerJoin(seasonShirts, eq(seasonShirts.seasonId, season.id))
            .where(
              and(
                eq(season.leagueId, input.leagueId),
                eq(seasonShirts.status, "received"),
              ),
            ),
        ),
      ),
    )
    .returning({ id: registration.id });
  if (received.length > 0)
    await recordAudit(db, {
      actorId: input.actorId,
      action: "shirts.batch_receive",
      entityType: "league",
      entityId: input.leagueId,
      leagueId: input.leagueId,
      after: { players: received.length },
    });
  return received.length;
}

/**
 * A team chooses to wear its own shirts or jerseys, or goes back to the
 * league's. Shirts already ordered for its players stay in the order that
 * has them; the count comes back so the captain can be told.
 */
export async function setOwnShirts(
  db: Db,
  input: { teamSeasonId: TeamSeasonId; own: boolean; actorId: UserId },
): Promise<Result<{ alreadyOrdered: number }, "not_found">> {
  const [before] = await db
    .select({ own: teamSeason.ownShirts })
    .from(teamSeason)
    .where(eq(teamSeason.id, input.teamSeasonId))
    .for("update");
  if (!before) return err("not_found");
  const [{ alreadyOrdered } = { alreadyOrdered: 0 }] = await db
    .select({ alreadyOrdered: sql<number>`count(*)`.mapWith(Number) })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .where(
      and(
        eq(rosterMembership.teamSeasonId, input.teamSeasonId),
        eq(rosterMembership.status, "active"),
        inArray(registration.shirtStatus, ["ordered", "received"]),
      ),
    );
  if (before.own !== input.own) {
    await db
      .update(teamSeason)
      .set({ ownShirts: input.own })
      .where(eq(teamSeason.id, input.teamSeasonId));
    await recordAudit(db, {
      actorId: input.actorId,
      action: "shirts.own_shirts",
      entityType: "team_season",
      entityId: input.teamSeasonId,
      before: { ownShirts: before.own },
      after: { ownShirts: input.own },
    });
  }
  return ok({ alreadyOrdered: input.own ? alreadyOrdered : 0 });
}

/** Sets the line describing a team's shirt this season; null clears it. */
export async function setShirtDesign(
  db: Db,
  input: { teamSeasonId: TeamSeasonId; design: string | null; actorId: UserId },
): Promise<Result<void, "not_found">> {
  const [before] = await db
    .select({ design: teamSeason.shirtDesign })
    .from(teamSeason)
    .where(eq(teamSeason.id, input.teamSeasonId))
    .for("update");
  if (!before) return err("not_found");
  if (before.design === input.design) return ok(undefined);
  await db
    .update(teamSeason)
    .set({ shirtDesign: input.design })
    .where(eq(teamSeason.id, input.teamSeasonId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.design",
    entityType: "team_season",
    entityId: input.teamSeasonId,
    before: { shirtDesign: before.design },
    after: { shirtDesign: input.design },
  });
  return ok(undefined);
}

/** A team's shirt choice and design line, for its page. */
export async function teamShirtInfo(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<{ ownShirts: boolean; design: string | null } | null> {
  const [row] = await db
    .select({ ownShirts: teamSeason.ownShirts, design: teamSeason.shirtDesign })
    .from(teamSeason)
    .where(eq(teamSeason.id, teamSeasonId));
  return row ?? null;
}
