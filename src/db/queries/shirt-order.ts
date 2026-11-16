import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { ExpenseId, LeagueId, SeasonId, UserId } from "@/domain/ids";
import {
  DEFAULT_SEASON_SIZES,
  expenseNote,
  type OrderJersey,
  type OrderStatus,
  seasonSize,
} from "@/domain/shirts/order";
import { type ShirtSize, sizeLabel } from "@/domain/shirts/summary";
import { err, ok, type Result } from "@/domain/result";
import type { ShirtSizePayload } from "@/emails/shirt-size";
import { user } from "../schema/auth";
import { merchItem, merchOrder } from "../schema/merch";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { seasonShirts } from "../schema/shirts";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { addExpense } from "./books";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";
import { shirtBoard } from "./shirts";

/**
 * A season's shirt order (docs/data-model.md, section 2.1): the sizes
 * players pick from, the order's state, and the replacement jerseys from
 * the league shop to make with it. Sizes live on the player's profile;
 * every sign-up form asks for one from the season's list.
 */

export type ShirtSettings = {
  sizes: readonly ShirtSize[];
  status: OrderStatus;
  placedAt: Date | null;
  receivedAt: Date | null;
  costCents: number | null;
  vendor: string | null;
  expenseId: ExpenseId | null;
};

const DEFAULTS: ShirtSettings = {
  sizes: DEFAULT_SEASON_SIZES,
  status: "not_placed",
  placedAt: null,
  receivedAt: null,
  costCents: null,
  vendor: null,
  expenseId: null,
};

/** A season's sizes and order; the defaults until an admin changes them. */
export async function shirtSettings(
  db: Db,
  seasonId: SeasonId,
): Promise<ShirtSettings> {
  const [found] = await db
    .select({
      sizes: seasonShirts.sizes,
      status: seasonShirts.status,
      placedAt: seasonShirts.placedAt,
      receivedAt: seasonShirts.receivedAt,
      costCents: seasonShirts.costCents,
      vendor: seasonShirts.vendor,
      expenseId: seasonShirts.expenseId,
    })
    .from(seasonShirts)
    .where(eq(seasonShirts.seasonId, seasonId));
  return found ?? DEFAULTS;
}

/** The season's row, made with the defaults if missing, locked. */
async function lockSettings(db: Db, seasonId: SeasonId) {
  await db.insert(seasonShirts).values({ seasonId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(seasonShirts)
    .where(eq(seasonShirts.seasonId, seasonId))
    .for("update");
  if (!row) throw new Error("The season's shirt settings are missing");
  return row;
}

/**
 * Changes the sizes players pick from this season, until the order is
 * placed: after that the vendor is making the sizes already counted.
 */
export async function setSeasonSizes(
  db: Db,
  input: { seasonId: SeasonId; sizes: readonly ShirtSize[]; actorId: UserId },
): Promise<Result<void, "order_placed">> {
  const before = await lockSettings(db, input.seasonId);
  if (before.status !== "not_placed") return err("order_placed");
  await db
    .update(seasonShirts)
    .set({ sizes: [...input.sizes], updatedBy: input.actorId })
    .where(eq(seasonShirts.seasonId, input.seasonId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.sizes",
    entityType: "season",
    entityId: input.seasonId,
    before: { sizes: before.sizes },
    after: { sizes: input.sizes },
  });
  return ok(undefined);
}

/**
 * Sets the size a player picked when signing up for a season. It is their
 * size, so it goes on their profile.
 */
export async function saveShirtSize(
  db: Db,
  input: { userId: UserId; size: ShirtSize },
): Promise<void> {
  await db
    .update(profile)
    .set({ shirtSize: input.size })
    .where(eq(profile.userId, input.userId));
}

/**
 * Sign-ups that hold a spot this season, so the order counts them: not
 * waitlisted, cancelled or refunded.
 */
export const ON_ORDER = [
  "pending_waiver",
  "pending_payment",
  "active",
] as const;

const onOrder = (p: { registrationStatus: string }) =>
  ON_ORDER.some((s) => s === p.registrationStatus);

/**
 * Paid replacement jerseys from the league shop for this season's teams,
 * still to make: one entry per order.
 */
export async function seasonJerseys(
  db: Db,
  seasonId: SeasonId,
): Promise<OrderJersey[]> {
  const rows = await db
    .select({
      first: profile.firstName,
      last: profile.lastName,
      account: user.name,
      teamName: merchOrder.teamName,
      colorHex: merchOrder.colorHex,
      size: merchOrder.size,
      quantity: merchOrder.quantity,
    })
    .from(merchOrder)
    .innerJoin(merchItem, eq(merchItem.id, merchOrder.itemId))
    .innerJoin(teamSeason, eq(teamSeason.id, merchOrder.teamSeasonId))
    .innerJoin(user, eq(user.id, merchOrder.userId))
    .leftJoin(profile, eq(profile.userId, merchOrder.userId))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        eq(merchItem.kind, "team_jersey"),
        eq(merchOrder.status, "paid"),
      ),
    )
    .orderBy(asc(merchOrder.teamName), asc(merchOrder.size));
  return rows.map((r) => ({
    name: [r.first, r.last].filter(Boolean).join(" ") || r.account,
    teamName: r.teamName,
    colorHex: r.colorHex,
    size: r.size,
    quantity: r.quantity,
  }));
}

/** Everything the shirt order screen and the vendor's CSV need, in parallel. */
export async function shirtOrderBoard(db: Db, seasonId: SeasonId) {
  const [settings, board, jerseys] = await Promise.all([
    shirtSettings(db, seasonId),
    shirtBoard(db, seasonId),
    seasonJerseys(db, seasonId),
  ]);
  return {
    settings,
    // A team in its own shirts is not in the order, except players whose
    // shirt was already ordered before it chose that.
    teams: board.teams
      .map((t) => ({
        ...t,
        players: t.players.filter(
          (p) => onOrder(p) && !(t.ownShirts && p.status === "none"),
        ),
      }))
      .filter((t) => !t.ownShirts || t.players.length > 0),
    ownShirtTeams: board.teams
      .filter((t) => t.ownShirts)
      .map((t) => ({ teamSeasonId: t.teamSeasonId, name: t.name })),
    freeAgents: board.freeAgents.filter(onOrder),
    jerseys,
  };
}

export type OrderChangeError = "not_placed" | "already_received" | "in_books";

/**
 * Marks the order placed with the vendor, or corrects its cost and vendor
 * while it is placed. Players with a size whose shirt was not ordered yet
 * are marked ordered, so shirt tracking shows who is in this order and who
 * joined after it.
 */
export async function placeShirtOrder(
  db: Db,
  input: {
    seasonId: SeasonId;
    costCents: number | null;
    vendor: string | null;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<{ players: number }, OrderChangeError>> {
  const before = await lockSettings(db, input.seasonId);
  if (before.status === "received") return err("already_received");
  // The books keep the cost they were given; correct it there instead.
  if (before.expenseId !== null && before.costCents !== input.costCents)
    return err("in_books");
  const placedAt = before.placedAt ?? input.now;
  await db
    .update(seasonShirts)
    .set({
      status: "placed",
      placedAt,
      costCents: input.costCents,
      vendor: input.vendor,
      updatedBy: input.actorId,
    })
    .where(eq(seasonShirts.seasonId, input.seasonId));
  const ordered =
    before.status === "not_placed"
      ? await db
          .update(registration)
          .set({ shirtStatus: "ordered" })
          .where(
            and(
              eq(registration.seasonId, input.seasonId),
              eq(registration.shirtStatus, "none"),
              inArray(registration.status, [...ON_ORDER]),
              // A team in its own shirts is left out of the order.
              notInArray(
                registration.id,
                db
                  .select({ id: rosterMembership.registrationId })
                  .from(rosterMembership)
                  .innerJoin(
                    teamSeason,
                    eq(teamSeason.id, rosterMembership.teamSeasonId),
                  )
                  .where(
                    and(
                      eq(rosterMembership.status, "active"),
                      eq(teamSeason.ownShirts, true),
                    ),
                  ),
              ),
              inArray(
                registration.userId,
                db
                  .select({ id: profile.userId })
                  .from(profile)
                  .where(inArray(profile.shirtSize, [...before.sizes])),
              ),
            ),
          )
          .returning({ id: registration.id })
      : [];
  await recordAudit(db, {
    actorId: input.actorId,
    action:
      before.status === "not_placed"
        ? "shirts.order_place"
        : "shirts.order_update",
    entityType: "season",
    entityId: input.seasonId,
    before: {
      status: before.status,
      costCents: before.costCents,
      vendor: before.vendor,
    },
    after: {
      status: "placed",
      costCents: input.costCents,
      vendor: input.vendor,
      playersMarkedOrdered: ordered.length,
    },
  });
  return ok({ players: ordered.length });
}

/**
 * The shirts arrived: the order is received, and every shirt marked
 * ordered for the season is marked received.
 */
export async function receiveShirtOrder(
  db: Db,
  input: { seasonId: SeasonId; actorId: UserId; now: Date },
): Promise<Result<{ players: number }, OrderChangeError>> {
  const before = await lockSettings(db, input.seasonId);
  if (before.status === "not_placed") return err("not_placed");
  if (before.status === "received") return err("already_received");
  await db
    .update(seasonShirts)
    .set({
      status: "received",
      receivedAt: input.now,
      updatedBy: input.actorId,
    })
    .where(eq(seasonShirts.seasonId, input.seasonId));
  const received = await db
    .update(registration)
    .set({ shirtStatus: "received" })
    .where(
      and(
        eq(registration.seasonId, input.seasonId),
        eq(registration.shirtStatus, "ordered"),
      ),
    )
    .returning({ id: registration.id });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.order_receive",
    entityType: "season",
    entityId: input.seasonId,
    before: { status: before.status },
    after: { status: "received", playersMarkedReceived: received.length },
  });
  return ok({ players: received.length });
}

export type BooksError =
  "not_placed" | "no_cost" | "already_in_books" | "unknown_season";

/**
 * Adds the order's cost to the owners' books as a "shirts" expense on the
 * day it was placed, once: the expense is remembered on the order, so a
 * second tap changes nothing. The caller checks books.manage.
 */
export async function addOrderToBooks(
  db: Db,
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    /** The day the order was placed, in the league's time zone. */
    spentOn: (placedAt: Date) => string;
    actorId: UserId;
  },
): Promise<Result<ExpenseId, BooksError>> {
  const row = await lockSettings(db, input.seasonId);
  if (row.status === "not_placed" || !row.placedAt) return err("not_placed");
  if (row.costCents === null) return err("no_cost");
  if (row.expenseId !== null) return err("already_in_books");
  const [s] = await db
    .select({ name: season.name })
    .from(season)
    .where(
      and(eq(season.id, input.seasonId), eq(season.leagueId, input.leagueId)),
    );
  if (!s) return err("unknown_season");
  const added = await addExpense(
    db,
    {
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      spentOn: input.spentOn(row.placedAt),
      amountCents: row.costCents,
      category: "shirts",
      note: expenseNote(s.name, row.vendor),
      receipt: null,
    },
    input.actorId,
  );
  if (!added.ok) return err("unknown_season");
  await db
    .update(seasonShirts)
    .set({ expenseId: added.value, updatedBy: input.actorId })
    .where(eq(seasonShirts.seasonId, input.seasonId));
  return ok(added.value);
}

/** "XS, S, M and L". */
export function sizesLine(sizes: readonly ShirtSize[]): string {
  const labels = sizes.map(sizeLabel);
  return labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Asks every player registered for the season without a size it offers
 * to pick one. Each registration is asked once, ever: the outbox skips a
 * message whose key it has seen. Returns how many were asked now.
 */
export async function remindMissingSizes(
  db: Db,
  input: { seasonId: SeasonId; actorId: UserId; now: Date },
): Promise<number> {
  const [settings, [s], people] = await Promise.all([
    shirtSettings(db, input.seasonId),
    db
      .select({ name: season.name })
      .from(season)
      .where(eq(season.id, input.seasonId)),
    db
      .select({
        registrationId: registration.id,
        userId: registration.userId,
        size: profile.shirtSize,
      })
      .from(registration)
      .leftJoin(profile, eq(profile.userId, registration.userId))
      .where(
        and(
          eq(registration.seasonId, input.seasonId),
          inArray(registration.status, [...ON_ORDER]),
        ),
      ),
  ]);
  if (!s) return 0;
  const missing = people.filter(
    (p) => seasonSize(p.size, settings.sizes) === null,
  );
  if (missing.length === 0) return 0;
  const payload: ShirtSizePayload = {
    seasonName: s.name,
    sizes: sizesLine(settings.sizes),
  };
  const sent = await enqueueMessages(
    db,
    missing.map((p) => ({
      userId: p.userId,
      topic: "payment" as const,
      template: "shirt_size_reminder",
      payload,
      dedupeKey: `shirt-size/${p.registrationId}`,
      sendAfter: input.now,
    })),
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.remind",
    entityType: "season",
    entityId: input.seasonId,
    after: { missing: missing.length, asked: sent },
  });
  return sent;
}

/** How many of a season's players were already asked for their size. */
export async function remindedCount(
  db: Db,
  seasonId: SeasonId,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(message)
    .innerJoin(
      registration,
      eq(message.dedupeKey, sql`'shirt-size/' || ${registration.id}`),
    )
    .where(eq(registration.seasonId, seasonId));
  return row?.n ?? 0;
}

/** A download of the vendor's CSV, in the audit log. */
export async function recordShirtExport(
  db: Db,
  input: {
    actorId: UserId;
    seasonId: SeasonId;
    rows: number;
    names: boolean;
  },
): Promise<void> {
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirts.export",
    entityType: "season",
    entityId: input.seasonId,
    after: { rows: input.rows, names: input.names },
  });
}
