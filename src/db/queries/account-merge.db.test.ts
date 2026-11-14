import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { accountMerge } from "../schema/account-merge";
import { auditLog } from "../schema/audit";
import { account, passkey, session, user } from "../schema/auth";
import { awardPoll, awardVote } from "../schema/awards";
import { creditEntry } from "../schema/credit";
import { gameRsvp } from "../schema/game";
import { notificationPreference, pushSubscription } from "../schema/message";
import { purchase } from "../schema/money";
import { profile } from "../schema/profile";
import { registration } from "../schema/team";
import { waiver, waiverSignature } from "../schema/waiver";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  accountByEmail,
  canonicalEmail,
  mergeAccounts,
  mergePreview,
} from "./account-merge";
import { deleteAccount } from "./account";
import { grantGoodwill } from "./credit";
import {
  emergencyCardOf,
  hasEmergencyContact,
  saveEmergencyContact,
} from "./emergency";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-20T17:00:00Z");
// A stand-in for the auth secret: long enough, plainly not a real one.
const SECRET = "merge-test-secret-not-a-real-one-000001";
const DAY = 86_400_000;

/**
 * A season where one player (Ace One, kept) also signed up a second time
 * (the duplicate) and did a little of everything with both accounts.
 */
async function duplicateWorld(db: Db) {
  const w = await messagingWorld(db);
  const kept = required(w.aces.players[0], "player");
  const admin = await w.person("admin");
  await db.insert(profile).values([
    { userId: admin.userId, globalRole: "admin" },
    { userId: kept.userId, firstName: "Ace", lastName: null },
  ]);
  // The duplicate registered for the same season but never joined a team.
  const dup = await w.person("dup");
  await db.insert(profile).values({
    userId: dup.userId,
    firstName: "Ace",
    lastName: "Duplicate",
    phoneE164: "+15555550123",
  });

  const g1 = await w.gameEnding(new Date(NOW.getTime() + DAY));
  const g2 = await w.gameEnding(new Date(NOW.getTime() + 8 * DAY));
  await db.insert(gameRsvp).values([
    {
      gameId: g1.gameId,
      userId: kept.userId,
      teamSeasonId: w.aces.id,
      status: "in",
    },
    {
      gameId: g1.gameId,
      userId: dup.userId,
      teamSeasonId: w.aces.id,
      status: "out",
    },
    {
      gameId: g2.gameId,
      userId: dup.userId,
      teamSeasonId: w.aces.id,
      status: "maybe",
    },
  ]);

  const [wv] = await db
    .insert(waiver)
    .values({
      leagueId: w.leagueId,
      title: "Sample waiver",
      version: 1,
      bodyMd: "Sample text",
      bodySha256: "0".repeat(64),
    })
    .returning({ id: waiver.id });
  const waiverId = required(wv, "waiver").id;
  const sign = (userId: UserId, at: Date) =>
    db
      .insert(waiverSignature)
      .values({
        waiverId,
        seasonId: w.season.id,
        userId,
        signedName: "Ace",
        signedAt: at,
        bodySha256: "0".repeat(64),
      })
      .returning({ id: waiverSignature.id });
  const keptSig = required((await sign(kept.userId, NOW))[0], "sig");
  const dupSig = required(
    (await sign(dup.userId, new Date(NOW.getTime() - DAY)))[0],
    "sig",
  );
  await db
    .update(registration)
    .set({ waiverSignatureId: keptSig.id })
    .where(eq(registration.id, kept.registrationId));

  const [poll] = await db
    .insert(awardPoll)
    .values({
      seasonId: w.season.id,
      category: "mvp",
      kind: "season",
      title: "MVP",
      opensAt: new Date(NOW.getTime() - DAY),
      closesAt: new Date(NOW.getTime() + 7 * DAY),
    })
    .returning({ id: awardPoll.id });
  const pollId = required(poll, "poll").id;
  const other = required(w.aces.players[1], "player");
  await db.insert(awardVote).values([
    { awardPollId: pollId, voterId: kept.userId, nomineeUserId: other.userId },
    {
      awardPollId: pollId,
      voterId: dup.userId,
      nomineeUserId: w.aces.captain.userId,
    },
    // A vote for the duplicate becomes a vote for the kept account.
    { awardPollId: pollId, voterId: other.userId, nomineeUserId: dup.userId },
  ]);

  await db.insert(notificationPreference).values([
    { userId: kept.userId, topic: "rainout", channel: "email", enabled: true },
    { userId: dup.userId, topic: "rainout", channel: "email", enabled: false },
    { userId: dup.userId, topic: "events", channel: "email", enabled: false },
  ]);
  await db.insert(pushSubscription).values({
    userId: dup.userId,
    endpoint: `https://push.example.test/${w.tag}`,
    p256dh: "k".repeat(87),
    auth: "a".repeat(22),
  });
  await db.insert(passkey).values({
    userId: dup.userId,
    publicKey: "pk",
    credentialID: `cred-${w.tag}`,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });
  await db.insert(account).values({
    userId: dup.userId,
    providerId: "google",
    accountId: `google-${w.tag}`,
    updatedAt: NOW,
  });
  await db.insert(session).values({
    userId: dup.userId,
    token: `token-${w.tag}`,
    expiresAt: new Date(NOW.getTime() + 30 * DAY),
    updatedAt: NOW,
  });
  await grantGoodwill(db, {
    email: dup.email,
    cents: 1500,
    note: "Rained out",
    actorId: admin.userId,
  });
  await db.insert(purchase).values({
    userId: dup.userId,
    seasonId: w.season.id,
    status: "paid",
    subtotalCents: 2000,
    totalCents: 2000,
  });
  return {
    w,
    kept,
    dup,
    admin,
    other,
    pollId,
    keptSig: keptSig.id,
    dupSig: dupSig.id,
    games: [g1.gameId, g2.gameId],
  };
}

const owned = async <T extends { userId: unknown }>(
  rows: Promise<T[]>,
): Promise<T[]> => rows;

describe("merging duplicate accounts", () => {
  it("previews what moves and how each clash is settled, changing nothing", async () => {
    await inRolledBackDb(async (db) => {
      const d = await duplicateWorld(db);
      const preview = required(
        await mergePreview(db, {
          keptId: d.kept.userId,
          mergedId: d.dup.userId,
          actorId: d.admin.userId,
        }),
        "preview",
      );
      expect(preview.blockers).toEqual([]);
      const moves = Object.fromEntries(
        preview.moves.map((m) => [m.label, m.count]),
      );
      expect(moves).toMatchObject({
        "game RSVPs": 2,
        "league credit": 1,
        "purchases and payments": 1,
        passkeys: 1,
        "sign-in methods": 1,
        "push subscriptions": 1,
        "waiver signatures": 1,
        registrations: 1,
      });
      const clashes = preview.conflicts.map((c) => c.label).join("\n");
      expect(clashes).toContain("same game");
      expect(clashes).toContain("earliest signature");
      expect(clashes).toContain("same awards poll");
      expect(clashes).toContain("same season");
      // Nothing moved.
      const [still] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, d.dup.userId));
      expect(still?.email).toBe(d.dup.email);
    });
  });

  it("carries a sealed emergency contact over only when the kept account has none", async () => {
    await inRolledBackDb(async (db) => {
      const d = await duplicateWorld(db);
      const card = {
        name: "Sam Example",
        relationship: "partner",
        phone: "+17185550199",
        firstAid: "Asthma",
      };
      await saveEmergencyContact(db, {
        userId: d.dup.userId,
        card,
        secret: SECRET,
        now: NOW,
      });
      const result = await mergeAccounts(db, {
        keptId: d.kept.userId,
        mergedId: d.dup.userId,
        actorId: d.admin.userId,
        now: NOW,
        secret: SECRET,
      });
      expect(result.ok && result.value.moved["emergency contact"]).toBe(1);
      // Sealed again for the kept account, and gone from the other.
      expect(await emergencyCardOf(db, d.kept.userId, SECRET)).toEqual(card);
      expect(await hasEmergencyContact(db, d.dup.userId)).toBe(false);
    });
  });

  it("keeps the kept account's own emergency contact over the other's", async () => {
    await inRolledBackDb(async (db) => {
      const d = await duplicateWorld(db);
      const mine = {
        name: "Jo Example",
        relationship: null,
        phone: "+17185550188",
        firstAid: null,
      };
      for (const [userId, name] of [
        [d.kept.userId, "Jo Example"],
        [d.dup.userId, "Sam Example"],
      ] as const)
        await saveEmergencyContact(db, {
          userId,
          card: { ...mine, name },
          secret: SECRET,
          now: NOW,
        });
      await mergeAccounts(db, {
        keptId: d.kept.userId,
        mergedId: d.dup.userId,
        actorId: d.admin.userId,
        now: NOW,
        secret: SECRET,
      });
      expect(await emergencyCardOf(db, d.kept.userId, SECRET)).toEqual(mine);
      expect(await hasEmergencyContact(db, d.dup.userId)).toBe(false);
    });
  });

  it("moves everything to the kept account in one transaction", async () => {
    await inRolledBackDb(async (db) => {
      const d = await duplicateWorld(db);
      const keptId = d.kept.userId;
      const dupId = d.dup.userId;
      const result = await mergeAccounts(db, {
        keptId,
        mergedId: dupId,
        actorId: d.admin.userId,
        now: NOW,
        secret: SECRET,
      });
      expect(result.ok).toBe(true);

      // One RSVP per game; the kept account's answer stood.
      const rsvps = await db
        .select({ gameId: gameRsvp.gameId, status: gameRsvp.status })
        .from(gameRsvp)
        .where(inArray(gameRsvp.userId, [keptId, dupId]));
      expect(rsvps.sort((a, b) => a.gameId.localeCompare(b.gameId))).toEqual(
        [
          { gameId: d.games[0], status: "in" },
          { gameId: d.games[1], status: "maybe" },
        ].sort((a, b) => a.gameId!.localeCompare(b.gameId!)),
      );

      // The earliest waiver signature stays, and the registration points at it.
      const sigs = await db
        .select({ id: waiverSignature.id, userId: waiverSignature.userId })
        .from(waiverSignature)
        .where(inArray(waiverSignature.id, [d.keptSig, d.dupSig]));
      expect(sigs).toEqual([{ id: d.dupSig, userId: keptId }]);
      const regs = await db
        .select({ id: registration.id, sig: registration.waiverSignatureId })
        .from(registration)
        .where(inArray(registration.userId, [keptId, dupId]));
      expect(regs).toEqual([{ id: d.kept.registrationId, sig: d.dupSig }]);

      // One vote per poll, the kept account's; the vote for the duplicate moved.
      const votes = await db
        .select({ voter: awardVote.voterId, nominee: awardVote.nomineeUserId })
        .from(awardVote)
        .where(eq(awardVote.awardPollId, d.pollId));
      expect(votes).toHaveLength(2);
      expect(votes).toContainEqual({ voter: keptId, nominee: d.other.userId });
      expect(votes).toContainEqual({ voter: d.other.userId, nominee: keptId });

      // Settings: the kept account's win, new ones move.
      const prefs = await db
        .select({
          topic: notificationPreference.topic,
          enabled: notificationPreference.enabled,
        })
        .from(notificationPreference)
        .where(eq(notificationPreference.userId, keptId));
      expect(prefs).toContainEqual({ topic: "rainout", enabled: true });
      expect(prefs).toContainEqual({ topic: "events", enabled: false });

      // Money, sign-in and devices follow the person.
      for (const rows of [
        owned(
          db
            .select({ userId: creditEntry.userId })
            .from(creditEntry)
            .where(inArray(creditEntry.userId, [keptId, dupId])),
        ),
        owned(
          db
            .select({ userId: purchase.userId })
            .from(purchase)
            .where(inArray(purchase.userId, [keptId, dupId])),
        ),
        owned(
          db
            .select({ userId: passkey.userId })
            .from(passkey)
            .where(inArray(passkey.userId, [keptId, dupId])),
        ),
        owned(
          db
            .select({ userId: account.userId })
            .from(account)
            .where(inArray(account.userId, [keptId, dupId])),
        ),
        owned(
          db
            .select({ userId: pushSubscription.userId })
            .from(pushSubscription)
            .where(inArray(pushSubscription.userId, [keptId, dupId])),
        ),
      ]) {
        const found = await rows;
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((r) => r.userId === keptId)).toBe(true);
      }
      expect(
        await db.select().from(session).where(eq(session.userId, dupId)),
      ).toEqual([]);

      // The kept profile filled its gap; the duplicate's profile is gone.
      const [p] = await db
        .select({ phone: profile.phoneE164, first: profile.firstName })
        .from(profile)
        .where(eq(profile.userId, keptId));
      expect(p).toEqual({ phone: "+15555550123", first: "Ace" });
      expect(
        await db.select().from(profile).where(eq(profile.userId, dupId)),
      ).toEqual([]);

      // The duplicate can't sign in, and its address is now an alias.
      const [gone] = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, dupId));
      expect(gone).toEqual({
        email: `merged-${dupId}@deleted.invalid`,
        name: "Merged account",
      });
      expect(await canonicalEmail(db, d.dup.email.toUpperCase())).toBe(
        d.kept.email,
      );
      expect(await accountByEmail(db, d.dup.email)).toMatchObject({
        id: keptId,
        viaAlias: true,
      });
      const [record] = await db
        .select({ email: accountMerge.mergedEmail })
        .from(accountMerge)
        .where(eq(accountMerge.mergedUserId, dupId));
      expect(record?.email).toBe(d.dup.email);
      const [audit] = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, keptId));
      expect(audit?.action).toBe("account.merge");

      // Nothing that names a person still names the duplicate, except the
      // merge record itself.
      const again = required(
        await mergePreview(db, {
          keptId,
          mergedId: dupId,
          actorId: d.admin.userId,
        }),
        "preview",
      );
      expect(again.moves).toEqual([]);
      expect(again.blockers).toContainEqual({
        kind: "already_merged",
        which: "merged",
      });

      // Deleting the kept account later ends the alias too.
      expect((await deleteAccount(db, keptId, NOW)).ok).toBe(true);
      expect(await canonicalEmail(db, d.dup.email)).toBeNull();
    });
  });

  it("refuses a merge that would lose a payment or a role, and changes nothing", async () => {
    await inRolledBackDb(async (db) => {
      const d = await duplicateWorld(db);
      // Both registrations now have a team spot.
      const [dupReg] = await db
        .select({ id: registration.id })
        .from(registration)
        .where(eq(registration.userId, d.dup.userId));
      await d.w.join(d.w.bees.id, {
        ...d.dup,
        registrationId: required(dupReg, "reg").id,
      });
      const attempt = await mergeAccounts(db, {
        keptId: d.kept.userId,
        mergedId: d.dup.userId,
        actorId: d.admin.userId,
        now: NOW,
        secret: SECRET,
      });
      expect(attempt.ok).toBe(false);
      if (!attempt.ok)
        expect(attempt.error).toContainEqual({
          kind: "both_registered",
          season: "Fall 2026",
        });

      const roles = await mergePreview(db, {
        keptId: d.kept.userId,
        mergedId: d.admin.userId,
        actorId: d.admin.userId,
      });
      expect(roles?.blockers).toEqual(
        expect.arrayContaining([
          { kind: "acting_admin" },
          { kind: "higher_role", role: "admin" },
        ]),
      );
      expect(
        (
          await mergePreview(db, {
            keptId: d.kept.userId,
            mergedId: d.kept.userId,
            actorId: d.admin.userId,
          })
        )?.blockers,
      ).toEqual([{ kind: "same_account" }]);
      // Still two accounts.
      const [still] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, d.dup.userId));
      expect(still?.email).toBe(d.dup.email);
    });
  });
});
