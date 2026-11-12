import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "../schema/audit";
import { account, session, user, verification } from "../schema/auth";
import { message, notificationPreference } from "../schema/message";
import { payment, purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { invite, registration, rosterMembership } from "../schema/team";
import { NOW, leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  DELETED_NAME,
  deleteAccount,
  deleteBlocker,
  deletedEmail,
  personalData,
} from "./account";
import { rosterBoard } from "./invites";
import { paymentsExport, rosterExport } from "./exports";
import type { Db } from "./schedule";

afterAll(closePool);

const SECRET_TOKEN = "session-token-that-must-not-leak";
const SECRET_ACCESS = "provider-access-token-that-must-not-leak";

/** Sessions, a linked sign-in, settings and mail for the teammate. */
async function withAccountData(
  db: Db,
  w: Awaited<ReturnType<typeof leagueWorld>>,
) {
  const email = w.emails[1] ?? "";
  await db.insert(session).values({
    token: SECRET_TOKEN,
    userId: w.teammate,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    ipAddress: "203.0.113.7",
    userAgent: "Test browser",
    updatedAt: NOW,
  });
  await db.insert(account).values({
    accountId: "google-123",
    providerId: "google",
    userId: w.teammate,
    accessToken: SECRET_ACCESS,
    updatedAt: NOW,
  });
  await db.insert(verification).values({
    identifier: "magic-link:abc",
    value: JSON.stringify({ type: "magic-link", email, name: "" }),
    expiresAt: new Date(NOW.getTime() + 900_000),
  });
  await db.insert(notificationPreference).values({
    userId: w.teammate,
    topic: "marketing",
    channel: "email",
    enabled: true,
  });
  await db.insert(message).values({
    userId: w.teammate,
    topic: "payment",
    template: "payment-reminder",
    payload: { amount: "45.00" },
    dedupeKey: `test-${w.teammate}`,
  });
  await db.insert(invite).values({
    teamSeasonId: w.otherTeamSeasonId,
    tokenHash: "a".repeat(64),
    email: email.toUpperCase(),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  await db
    .update(rosterMembership)
    .set({ sharesContact: true })
    .where(eq(rosterMembership.registrationId, w.teammateRegistration));
  return email;
}

describe("the personal data export", () => {
  it("includes the person's profile, registrations, payments and settings", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const email = await withAccountData(db, w);
      const data = await personalData(db, w.teammate, NOW);
      expect(data).toMatchObject({
        exportedAt: NOW.toISOString(),
        account: { email },
        profile: { lastName: "Kicker", shirtSize: "l" },
        signInMethods: [{ provider: "google" }],
        sessions: [{ ipAddress: "203.0.113.7", userAgent: "Test browser" }],
        registrations: [
          {
            season: "Spring 2027",
            status: "active",
            teams: [{ team: "Kick Bottom", role: "player" }],
          },
        ],
        purchases: [
          {
            status: "paid",
            totalCents: 4500,
            items: [{ description: "Spring 2027: Kick Bottom" }],
            payments: [{ method: "cash", amountCents: 4500 }],
          },
        ],
        emailSettings: [{ topic: "marketing", enabled: true }],
        messages: [{ template: "payment-reminder" }],
      });
    });
  });

  it("never includes tokens, and nobody else's data", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await withAccountData(db, w);
      const text = JSON.stringify(await personalData(db, w.teammate, NOW));
      expect(text).not.toContain(SECRET_TOKEN);
      expect(text).not.toContain(SECRET_ACCESS);
      expect(text).not.toContain("magic-link:abc");
      expect(text).not.toContain("Robin");
      expect(text).not.toContain(w.emails[0]);
      expect(text).not.toContain("+15555550101");
    });
  });

  it("holds only the anonymized shell after deletion", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await deleteAccount(db, w.teammate);
      // The anonymized row still exists, so the export is the empty shell.
      const data = await personalData(db, w.teammate, NOW);
      expect(data?.account.email).toBe(deletedEmail(w.teammate));
      expect(data?.profile).toBeNull();
    });
  });
});

describe("deleting an account", () => {
  it("anonymizes the person and removes their personal data", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const email = await withAccountData(db, w);
      expect(await deleteAccount(db, w.teammate)).toEqual({
        ok: true,
        value: undefined,
      });

      const [row] = await db.select().from(user).where(eq(user.id, w.teammate));
      expect(row).toMatchObject({
        name: DELETED_NAME,
        email: deletedEmail(w.teammate),
        emailVerified: false,
        image: null,
      });
      const none = async (rows: Promise<unknown[]>) =>
        expect(await rows).toEqual([]);
      await none(
        db.select().from(profile).where(eq(profile.userId, w.teammate)),
      );
      await none(
        db.select().from(session).where(eq(session.userId, w.teammate)),
      );
      await none(
        db.select().from(account).where(eq(account.userId, w.teammate)),
      );
      await none(
        db
          .select()
          .from(verification)
          .where(eq(verification.identifier, "magic-link:abc")),
      );
      await none(
        db
          .select()
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, w.teammate)),
      );
      await none(
        db.select().from(message).where(eq(message.userId, w.teammate)),
      );
      const [inv] = await db
        .select({ email: invite.email, status: invite.status })
        .from(invite)
        .where(eq(invite.teamSeasonId, w.otherTeamSeasonId));
      expect(inv).toEqual({ email: null, status: "revoked" });
      // No trace of the old address is left on the user or invites.
      expect(await db.select().from(user).where(eq(user.email, email))).toEqual(
        [],
      );
    });
  });

  it("keeps league records intact under the anonymized name", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await withAccountData(db, w);
      await deleteAccount(db, w.teammate);

      const [reg] = await db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, w.teammateRegistration));
      expect(reg?.status).toBe("active");
      const [spot] = await db
        .select({
          status: rosterMembership.status,
          sharesContact: rosterMembership.sharesContact,
        })
        .from(rosterMembership)
        .where(eq(rosterMembership.registrationId, w.teammateRegistration));
      expect(spot).toEqual({ status: "active", sharesContact: false });

      expect(
        (await rosterBoard(db, w.teamSeasonId)).map((m) => m.name),
      ).toEqual(["Robin Example", DELETED_NAME]);
      const exported = await rosterExport(db, w.season.id, w.teamSeasonId);
      expect(exported[1]).toMatchObject({
        name: DELETED_NAME,
        email: deletedEmail(w.teammate),
        phone: null,
        shirtSize: null,
        paid: true,
      });
      const payments = await paymentsExport(db, w.season.id, null);
      expect(payments.map((p) => [p.payer, p.amountCents])).toEqual([
        [DELETED_NAME, 4500],
      ]);
      // Purchases and payments are kept for the league's accounts.
      const kept = await db
        .select({ id: payment.id })
        .from(payment)
        .innerJoin(purchase, eq(payment.purchaseId, purchase.id))
        .where(eq(purchase.userId, w.teammate));
      expect(kept).toHaveLength(1);
    });
  });

  it("writes an audit row that names no personal data", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await deleteAccount(db, w.teammate);
      const rows = await db
        .select({
          actorId: auditLog.actorId,
          before: auditLog.before,
          after: auditLog.after,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "account.delete"),
            eq(auditLog.entityId, w.teammate),
          ),
        );
      expect(rows).toEqual([
        { actorId: w.teammate, before: null, after: { anonymized: true } },
      ]);
    });
  });

  it("refuses while the person captains a team in a season that is not over", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      expect(await deleteBlocker(db, w.captain)).toEqual({
        reason: "captain",
        team: "Kick Bottom",
        season: "Spring 2027",
      });
      expect(await deleteAccount(db, w.captain)).toEqual({
        ok: false,
        error: "captain",
      });
      const [row] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, w.captain));
      expect(row?.name).toBe("Robin Example");

      // Once the season is over, the captain may go.
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await deleteBlocker(db, w.captain)).toBeNull();
    });
  });

  it("refuses for the league's only owner", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      // Make the admin the only owner in this database.
      await db
        .update(profile)
        .set({ globalRole: "admin" })
        .where(eq(profile.globalRole, "owner"));
      await db
        .update(profile)
        .set({ globalRole: "owner" })
        .where(eq(profile.userId, w.admin));
      expect(await deleteAccount(db, w.admin)).toEqual({
        ok: false,
        error: "last_owner",
      });
      await db
        .update(profile)
        .set({ globalRole: "owner" })
        .where(eq(profile.userId, w.agent));
      expect(await deleteBlocker(db, w.admin)).toBeNull();
    });
  });
});
