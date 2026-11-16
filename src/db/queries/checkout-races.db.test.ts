import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { CheckoutItem } from "@/domain/registration/checkout";
import * as schema from "../schema";
import { user } from "../schema/auth";
import { creditEntry } from "../schema/credit";
import { league } from "../schema/league";
import { purchase } from "../schema/money";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { creditBalance } from "./credit";
import { startPurchaseFor } from "./payments";
import type { Db } from "./schedule";

/**
 * A double tap on Pay before the page's script loads sends the form twice
 * at once. Separate connections, so the two requests really overlap; each
 * test commits its own league and deletes it afterwards.
 */

const clients: Client[] = [];
const connect = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  clients.push(client);
  return drizzle({ client, schema, casing: "snake_case" });
};
afterAll(() => Promise.all(clients.map((c) => c.end())));

const FEE = 4500;

async function world(db: Db, creditCents: number) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [player] = await db
    .insert(user)
    .values({ name: "Payer", email: `checkout-race-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Checkout League", slug: `checkout-race-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Summer",
      slug: "summer",
      startsOn: "2027-06-05",
      endsOn: "2027-08-28",
      feeModel: "per_player",
      playerFeeCents: FEE,
      freeAgentFeeCents: FEE,
      rosterMin: 1,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  const [reg] = await db
    .insert(registration)
    .values({
      seasonId: sn!.id,
      userId: player!.id,
      kind: "free_agent",
      status: "pending_payment",
    })
    .returning({ id: registration.id });
  if (creditCents > 0)
    await db.insert(creditEntry).values({
      userId: player!.id,
      leagueId: lg!.id,
      deltaCents: creditCents,
      reason: "goodwill",
    });
  return {
    userId: player!.id,
    leagueId: lg!.id,
    seasonId: sn!.id,
    registrationId: reg!.id,
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function removeWorld(db: Db, w: World) {
  const purchases = db
    .select({ id: purchase.id })
    .from(purchase)
    .where(eq(purchase.userId, w.userId));
  await db.delete(creditEntry).where(eq(creditEntry.userId, w.userId));
  await db.execute(
    sql`delete from payment where purchase_id in (${purchases})`,
  );
  await db.execute(
    sql`delete from purchase_item where purchase_id in (${purchases})`,
  );
  await db.delete(purchase).where(eq(purchase.userId, w.userId));
  await db.delete(registration).where(eq(registration.userId, w.userId));
  await db.delete(season).where(eq(season.id, w.seasonId));
  await db.execute(sql`delete from audit_log where actor_id = ${w.userId}`);
  await db.delete(league).where(eq(league.id, w.leagueId));
  await db.delete(user).where(inArray(user.id, [w.userId]));
}

const fee = (w: World): CheckoutItem => ({
  kind: "free_agent_fee",
  amountCents: FEE,
  description: "Summer: free agent",
  registrationId: w.registrationId,
  teamSeasonId: null,
});

const pay = (db: Db, w: World) =>
  db.transaction((tx) =>
    startPurchaseFor(tx, {
      registrationId: w.registrationId,
      fee: true,
      userId: w.userId,
      leagueId: w.leagueId,
      seasonId: w.seasonId,
      items: [fee(w)],
      promoCode: null,
      useCredit: true,
      now: new Date(),
    }),
  );

async function withWorld(
  creditCents: number,
  body: (w: World) => Promise<void>,
) {
  const setup = await connect();
  const w = await world(setup, creditCents);
  try {
    await body(w);
  } finally {
    await removeWorld(setup, w);
  }
}

describe("Pay tapped twice at once", () => {
  it("never asks Stripe for the fee once credit has paid it", () =>
    withWorld(FEE, async (w) => {
      const [one, two] = [await connect(), await connect()];
      const results = await Promise.all([pay(one, w), pay(two, w)]);
      const started = results.flatMap((r) => (r.ok ? [r.value] : []));
      // One tap is paid by credit; the other hears it's already paid.
      expect(started).toHaveLength(1);
      expect(started[0]?.totalCents).toBe(0);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, error: "already_paid" },
      ]);
    }));

  it("opens one checkout with the credit on it, and the other tap waits", () =>
    withWorld(2000, async (w) => {
      const [one, two] = [await connect(), await connect()];
      const results = await Promise.all([pay(one, w), pay(two, w)]);
      const started = results.flatMap((r) => (r.ok ? [r.value] : []));
      expect(started).toHaveLength(1);
      expect(started[0]?.totalCents).toBe(FEE - 2000);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, error: "in_progress" },
      ]);
    }));

  it("gives back the credit of a checkout that never got its Stripe page", () =>
    withWorld(2000, async (w) => {
      const setup = await connect();
      const first = await pay(setup, w);
      expect(first.ok).toBe(true);
      // Stripe failed, so it has no session; three minutes on, Pay again.
      await setup
        .update(purchase)
        .set({ createdAt: sql`now() - interval '3 minutes'` })
        .where(eq(purchase.userId, w.userId));
      const again = await pay(setup, w);
      expect(again.ok && again.value.totalCents).toBe(FEE - 2000);
      expect(await creditBalance(setup, w.userId, w.leagueId)).toBe(0);
      const statuses = await setup
        .select({ status: purchase.status })
        .from(purchase)
        .where(eq(purchase.userId, w.userId));
      expect(statuses.map((s) => s.status).sort()).toEqual(["expired", "open"]);
    }));
});
