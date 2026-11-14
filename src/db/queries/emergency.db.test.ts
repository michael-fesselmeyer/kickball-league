import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { EmergencyCard } from "@/domain/emergency/emergency";
import type { GameId, UserId } from "@/domain/ids";
import { err } from "@/domain/result";
import { auditLog } from "../schema/audit";
import { emergencyContact } from "../schema/emergency";
import { profile } from "../schema/profile";
import { subClaim, subRequest } from "../schema/subs";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  emergencyCardOf,
  gameEmergencyCards,
  hasEmergencyContact,
  saveEmergencyContact,
} from "./emergency";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

// A stand-in for the auth secret: long enough, plainly not a real one.
const SECRET = "db-test-secret-not-a-real-one-00000001";
// Game day: Tuesday Sep 15, 2026. The game is 7 to 8 PM in New York.
const KICKOFF_END = new Date("2026-09-16T00:00:00Z");
const DURING = new Date("2026-09-15T23:30:00Z");
const MORNING = new Date("2026-09-15T13:00:00Z");
const DAY_BEFORE = new Date("2026-09-15T03:59:00Z");
const DAY_AFTER = new Date("2026-09-16T04:00:00Z");

const card = (name: string, firstAid: string | null = null): EmergencyCard => ({
  name,
  relationship: "partner",
  phone: "+17185550199",
  firstAid,
});

/**
 * Aces vs Bees on game day, reffed by the ref, with an admin, a sub the
 * Aces approved, and a third team's captain. Everyone has a profile so
 * loadSubject sees them.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const ref = await w.person("ref");
  const admin = await w.person("admin");
  const cats = await w.entry("Cats");
  const catsCaptain = await w.person("cat-cap");
  await w.join(cats, catsCaptain, "captain");
  const sub = await w.person("sub");
  const people = [
    w.aces.captain,
    ...w.aces.players,
    w.bees.captain,
    ...w.bees.players,
    w.freeAgent,
    ref,
    admin,
    catsCaptain,
    sub,
  ];
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.userId,
      firstName: `Pat${i}`,
      lastName: "Example",
      globalRole: p === admin ? ("admin" as const) : ("player" as const),
    })),
  );
  const { gameId } = await w.gameEnding(KICKOFF_END, ref.userId);
  const [request] = await db
    .insert(subRequest)
    .values({
      gameId,
      teamSeasonId: w.aces.id,
      requestedBy: w.aces.captain.userId,
      needed: 1,
      closesAt: KICKOFF_END,
    })
    .returning({ id: subRequest.id });
  await db.insert(subClaim).values({
    subRequestId: request!.id,
    userId: sub.userId,
    status: "approved",
  });
  for (const [p, name] of [
    [w.aces.players[0]!, "Sam Example"],
    [w.bees.players[0]!, "Jo Example"],
    [sub, "Lee Example"],
  ] as const)
    await saveEmergencyContact(db, {
      userId: p.userId,
      card: card(name, name === "Jo Example" ? "Asthma; inhaler in bag" : null),
      secret: SECRET,
      now: MORNING,
    });
  const view = async (who: { userId: UserId }, now: Date, id = gameId) =>
    gameEmergencyCards(db, {
      gameId: id,
      subject: await loadSubject(db, who.userId),
      viewerId: who.userId,
      secret: SECRET,
      now,
    });
  return { ...w, ref, admin, catsCaptain, sub, gameId, view };
}

const views = (db: Db) =>
  db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "emergency_contact.view"));

describe("saving a contact", () => {
  it("keeps it sealed, opens it for its owner, and replaces it on save", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const me = w.aces.players[0]!.userId;
      expect(await hasEmergencyContact(db, me)).toBe(false);
      await saveEmergencyContact(db, {
        userId: me,
        card: card("Sam Example", "Allergic to bee stings"),
        secret: SECRET,
        now: MORNING,
      });
      const [row] = await db
        .select()
        .from(emergencyContact)
        .where(eq(emergencyContact.userId, me));
      expect(row?.sealed).toMatch(/^v1\./);
      for (const plain of ["Sam", "555", "bee stings", "partner"])
        expect(row?.sealed).not.toContain(plain);
      expect(await emergencyCardOf(db, me, SECRET)).toEqual(
        card("Sam Example", "Allergic to bee stings"),
      );
      expect(await emergencyCardOf(db, me, `${SECRET}-other`)).toBeNull();

      await saveEmergencyContact(db, {
        userId: me,
        card: card("Jo Example"),
        secret: SECRET,
        now: DURING,
      });
      expect((await emergencyCardOf(db, me, SECRET))?.name).toBe("Jo Example");
      expect(await hasEmergencyContact(db, me)).toBe(true);
    });
  });

  it("won't open a sealed card copied onto another player", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const [from, to] = [w.aces.players[0]!.userId, w.bees.players[0]!.userId];
      await saveEmergencyContact(db, {
        userId: from,
        card: card("Sam Example"),
        secret: SECRET,
        now: MORNING,
      });
      const [row] = await db
        .select({ sealed: emergencyContact.sealed })
        .from(emergencyContact)
        .where(eq(emergencyContact.userId, from));
      await db
        .insert(emergencyContact)
        .values({ userId: to, sealed: row!.sealed });
      expect(await emergencyCardOf(db, to, SECRET)).toBeNull();
    });
  });
});

describe("who reads a game's contacts, and when", () => {
  it("shows the ref and both captains every player's card on game day, each read audited", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const who of [w.ref, w.aces.captain, w.bees.captain]) {
        const shown = await w.view(who, DURING);
        if (!shown.ok) throw new Error(shown.error);
        expect(shown.value.until).toEqual(DAY_AFTER);
        const [aces, bees] = shown.value.teams;
        expect(
          aces?.players.map((p) => [p.card?.name ?? null, p.sub]).sort(),
        ).toEqual(
          [
            [null, false],
            [null, false],
            ["Lee Example", true],
            ["Sam Example", false],
          ].sort(),
        );
        expect(bees?.players.find((p) => p.card)?.card).toEqual(
          card("Jo Example", "Asthma; inhaler in bag"),
        );
      }
      const audit = await views(db);
      expect(audit.map((a) => a.actorId).sort()).toEqual(
        [w.ref.userId, w.aces.captain.userId, w.bees.captain.userId].sort(),
      );
      for (const a of audit) {
        expect(a.entityId).toBe(w.gameId);
        expect(a.after).toEqual({ players: 7, withContact: 3 });
        // The log never copies a contact out.
        expect(JSON.stringify(a)).not.toContain("Example");
      }
    });
  });

  it("refuses players, the other teams' captains and admins, even on game day", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const who of [
        w.aces.players[0]!,
        w.bees.players[1]!,
        w.catsCaptain,
        w.admin,
        w.freeAgent,
        w.sub,
      ])
        expect(await w.view(who, DURING)).toEqual(err("not_yours"));
      expect(await views(db)).toEqual([]);
    });
  });

  it("refuses the game's own captains and ref the day before and the day after", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const who of [w.ref, w.aces.captain])
        for (const at of [DAY_BEFORE, DAY_AFTER])
          expect(await w.view(who, at)).toEqual(err("not_game_day"));
      expect((await w.view(w.ref, MORNING)).ok).toBe(true);
      expect(
        await w.view(
          w.ref,
          DURING,
          "00000000-0000-4000-8000-000000000000" as GameId,
        ),
      ).toEqual(err("not_found"));
    });
  });
});

describe("personal data", () => {
  it("puts the contact in the person's export, and deleting the account deletes it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const me = w.aces.players[0]!.userId;
      const data = await personalData(db, me, DURING, SECRET);
      expect(data?.emergencyContact).toEqual(card("Sam Example"));
      expect((await personalData(db, me, DURING))?.emergencyContact).toBe(
        "saved",
      );

      expect((await deleteAccount(db, me, DURING)).ok).toBe(true);
      expect(await hasEmergencyContact(db, me)).toBe(false);
      const after = await w.view(w.ref, DURING);
      if (!after.ok) throw new Error(after.error);
      expect(
        after.value.teams[0]?.players.find((p) => p.userId === me)?.card,
      ).toBeNull();
    });
  });
});
