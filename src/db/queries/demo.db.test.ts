import { afterAll, describe, expect, it } from "vitest";
import { message } from "../schema/message";
import { purchase, purchaseItem } from "../schema/money";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { demoMail, openDemoCheckout } from "./demo";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

async function checkout(
  db: Db,
  w: Awaited<ReturnType<typeof messagingWorld>>,
  status: "open" | "paid",
) {
  const session = `cs_test_demo_${Math.random().toString(36).slice(2)}`;
  const userId = w.aces.players[0]!.userId;
  const row = required(
    (
      await db
        .insert(purchase)
        .values({
          userId,
          leagueId: w.leagueId,
          seasonId: w.season.id,
          status,
          subtotalCents: 8000,
          discountCents: 1000,
          totalCents: 7000,
          stripeCheckoutSessionId: session,
        })
        .returning({ id: purchase.id })
    )[0],
    "purchase",
  );
  await db.insert(purchaseItem).values({
    purchaseId: row.id,
    kind: "player_fee",
    amountCents: 8000,
    description: "Spring 2027: player fee",
  });
  return { session, userId, purchaseId: row.id };
}

describe("openDemoCheckout", () => {
  it("finds a person's own open checkout with what it is for", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const c = await checkout(db, w, "open");
      expect(await openDemoCheckout(db, c.userId, c.session)).toEqual({
        id: c.purchaseId,
        totalCents: 7000,
        items: [{ description: "Spring 2027: player fee", amountCents: 8000 }],
      });
    }));

  it("never finds someone else's, a paid one, or one that doesn't exist", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const open = await checkout(db, w, "open");
      const paid = await checkout(db, w, "paid");
      const someoneElse = w.bees.captain.userId;
      expect(await openDemoCheckout(db, someoneElse, open.session)).toBeNull();
      expect(await openDemoCheckout(db, paid.userId, paid.session)).toBeNull();
      expect(
        await openDemoCheckout(db, open.userId, "cs_test_missing"),
      ).toBeNull();
    }));
});

describe("demoMail", () => {
  it("lists the outbox's emails newest first, with who they are for, and leaves push out", () =>
    inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const to = w.aces.captain;
      const tag = Math.random().toString(36).slice(2);
      const at = (minutes: number) =>
        new Date(Date.UTC(2099, 0, 1, 0, minutes));
      await db.insert(message).values([
        {
          userId: to.userId,
          topic: "rainout",
          template: "rainout_notice",
          dedupeKey: `demo-test/${tag}/older`,
          createdAt: at(1),
        },
        {
          userId: to.userId,
          topic: "payment",
          template: "payment_reminder",
          dedupeKey: `demo-test/${tag}/newer`,
          createdAt: at(2),
        },
        {
          userId: to.userId,
          topic: "payment",
          channel: "push",
          template: "payment_reminder",
          dedupeKey: `demo-test/${tag}/push`,
          createdAt: at(3),
        },
      ]);
      const mail = await demoMail(db, 2);
      expect(mail.map((m) => [m.template, m.email])).toEqual([
        ["payment_reminder", to.email],
        ["rainout_notice", to.email],
      ]);
    }));
});
