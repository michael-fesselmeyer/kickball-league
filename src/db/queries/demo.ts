import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { user } from "../schema/auth";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import type { LeagueId, UserId } from "@/domain/ids";
import { message } from "../schema/message";
import { purchase, purchaseItem } from "../schema/money";
import { season } from "../schema/season";
import type { Db } from "./schedule";

/** A slot's local date in its league's time zone. */
const localDay = sql`(${slot.startsAt} at time zone ${league.timezone})::date`;

/**
 * When a league's next game day after today starts: the first game still
 * to play on a later day than today, in its time zone. The demo's weather
 * fixture puts its showers there (docs/demo.md). Null when there is none.
 */
export async function nextGameDayStart(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<Date | null> {
  const [found] = await db
    .select({ startsAt: slot.startsAt })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        eq(league.id, leagueId),
        eq(game.status, "scheduled"),
        ne(season.status, "draft"),
        sql`${localDay} > (${now.toISOString()}::timestamptz at time zone ${league.timezone})::date`,
      ),
    )
    .orderBy(asc(slot.startsAt))
    .limit(1);
  return found?.startsAt ?? null;
}

/**
 * A person's own open Checkout, by its Stripe session id: what the demo's
 * checkout page shows and pays. Null when it is not theirs, or is paid or
 * closed.
 */
export async function openDemoCheckout(
  db: Db,
  userId: UserId,
  sessionId: string,
) {
  const [found] = await db
    .select({ id: purchase.id, totalCents: purchase.totalCents })
    .from(purchase)
    .where(
      and(
        eq(purchase.stripeCheckoutSessionId, sessionId),
        eq(purchase.userId, userId),
        eq(purchase.status, "open"),
      ),
    );
  if (!found) return null;
  const items = await db
    .select({
      description: purchaseItem.description,
      amountCents: purchaseItem.amountCents,
    })
    .from(purchaseItem)
    .where(eq(purchaseItem.purchaseId, found.id))
    .orderBy(asc(purchaseItem.description));
  return { ...found, items };
}

/**
 * The newest emails in the outbox, with who they are for: what the league
 * would have sent. The local demo has no email provider, so everything stays
 * here, and its "Demo mail" page shows it (docs/demo.md).
 */
export async function demoMail(db: Db, limit = 60) {
  return db
    .select({
      id: message.id,
      template: message.template,
      payload: message.payload,
      status: message.status,
      createdAt: message.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(message)
    .innerJoin(user, eq(message.userId, user.id))
    .where(eq(message.channel, "email"))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(limit);
}
