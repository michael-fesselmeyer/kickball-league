import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { UserId } from "@/domain/ids";
import { err, ok } from "@/domain/result";
import { auditLog } from "../schema/audit";
import { captainHandoff } from "../schema/captaincy";
import { message } from "../schema/message";
import { purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import { registration, rosterMembership } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount } from "./account";
import {
  answerCaptaincy,
  cancelCaptaincy,
  offerCaptaincy,
  setTeamRole,
  teamCaptaincy,
} from "./captaincy";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const NOW = new Date("2026-09-14T12:00:00Z");

async function world(db: Db) {
  const w = await messagingWorld(db);
  const captain = w.aces.captain;
  const mate = w.aces.players[0]!;
  const other = w.aces.players[1]!;
  // Only people with a profile are signed-in subjects.
  await db.insert(profile).values(
    [captain, mate, other, w.bees.captain].map((p) => ({
      userId: p.userId,
      firstName: "Sam",
    })),
  );
  return { ...w, captain, mate, other };
}

const roleOf = async (db: Db, userId: UserId) => {
  const [row] = await db
    .select({ role: rosterMembership.role })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
      ),
    );
  return row?.role ?? null;
};

const actions = (db: Db) =>
  db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(like(auditLog.action, "captaincy.%"))
    // Rows from one transaction share a time, so compare them sorted.
    .then((rows) => rows.map((r) => r.action).sort());

const messagesTo = (db: Db, userId: UserId) =>
  db
    .select({ template: message.template, payload: message.payload })
    .from(message)
    .where(and(eq(message.userId, userId), eq(message.topic, "team_roles")));

describe("handing the team to a teammate", () => {
  it("waits for the teammate, then swaps the roles and keeps the old captain as co-captain", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const offered = await offerCaptaincy(db, {
        teamSeasonId: w.aces.id,
        toUserId: w.mate.userId,
        actorId: w.captain.userId,
        now: NOW,
      });
      if (!offered.ok) throw new Error(offered.error);
      // Nothing changes until they accept.
      expect(await roleOf(db, w.captain.userId)).toBe("captain");
      expect(await roleOf(db, w.mate.userId)).toBe("player");
      expect(await messagesTo(db, w.mate.userId)).toMatchObject([
        { template: "captain_handoff", payload: { kind: "offered" } },
      ]);
      const team = await teamCaptaincy(db, w.aces.id);
      expect(team.pending?.toUserId).toBe(w.mate.userId);

      expect(
        await answerCaptaincy(db, {
          handoffId: offered.value,
          userId: w.mate.userId,
          accept: true,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      expect(await roleOf(db, w.mate.userId)).toBe("captain");
      expect(await roleOf(db, w.captain.userId)).toBe("co_captain");
      expect(await messagesTo(db, w.captain.userId)).toMatchObject([
        { template: "team_role", payload: { kind: "accepted" } },
      ]);
      expect(await actions(db)).toEqual([
        "captaincy.accept",
        "captaincy.offer",
      ]);
      // The new captain leads; the old one keeps the team's tools only.
      const before = await loadSubject(db, w.captain.userId);
      const after = await loadSubject(db, w.mate.userId);
      const team1 = { teamSeasonId: w.aces.id };
      expect(can(after, "captaincy.manage", team1)).toBe(true);
      expect(can(before, "captaincy.manage", team1)).toBe(false);
      expect(can(before, "lineup.edit", team1)).toBe(true);
      // Once answered, the offer can't be used again.
      expect(
        await answerCaptaincy(db, {
          handoffId: offered.value,
          userId: w.mate.userId,
          accept: true,
          now: NOW,
        }),
      ).toEqual(err("not_pending"));
    });
  });

  it("leaves everything as it was when the teammate says no, and tells the captain", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const offered = await offerCaptaincy(db, {
        teamSeasonId: w.aces.id,
        toUserId: w.mate.userId,
        actorId: w.captain.userId,
        now: NOW,
      });
      if (!offered.ok) throw new Error(offered.error);
      expect(
        await answerCaptaincy(db, {
          handoffId: offered.value,
          userId: w.mate.userId,
          accept: false,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      expect(await roleOf(db, w.captain.userId)).toBe("captain");
      expect(await roleOf(db, w.mate.userId)).toBe("player");
      expect(await messagesTo(db, w.captain.userId)).toMatchObject([
        { template: "team_role", payload: { kind: "declined" } },
      ]);
    });
  });

  it("lets only the teammate answer, and only one offer wait at a time", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const offer = (toUserId: UserId) =>
        offerCaptaincy(db, {
          teamSeasonId: w.aces.id,
          toUserId,
          actorId: w.captain.userId,
          now: NOW,
        });
      const first = await offer(w.mate.userId);
      const second = await offer(w.other.userId);
      if (!first.ok || !second.ok) throw new Error("Expected two offers");
      const rows = await db
        .select({ status: captainHandoff.status })
        .from(captainHandoff)
        .where(eq(captainHandoff.teamSeasonId, w.aces.id));
      expect(rows.map((r) => r.status).sort()).toEqual([
        "cancelled",
        "pending",
      ]);
      // Someone else can't take it, and the replaced offer is gone.
      expect(
        await answerCaptaincy(db, {
          handoffId: second.value,
          userId: w.mate.userId,
          accept: true,
          now: NOW,
        }),
      ).toEqual(err("not_found"));
      expect(
        await answerCaptaincy(db, {
          handoffId: first.value,
          userId: w.mate.userId,
          accept: true,
          now: NOW,
        }),
      ).toEqual(err("not_pending"));
      // Withdrawing is quiet: the teammate hears nothing more.
      expect(
        await cancelCaptaincy(db, {
          teamSeasonId: w.aces.id,
          actorId: w.captain.userId,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      expect(await messagesTo(db, w.other.userId)).toHaveLength(1);
    });
  });

  it("refuses someone off the roster and the captain themselves", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const offer = (toUserId: UserId) =>
        offerCaptaincy(db, {
          teamSeasonId: w.aces.id,
          toUserId,
          actorId: w.captain.userId,
          now: NOW,
        });
      expect(await offer(w.bees.captain.userId)).toEqual(err("not_on_team"));
      expect(await offer(w.captain.userId)).toEqual(err("already_captain"));
    });
  });

  it("waits while the team fee is being paid", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [open] = await db
        .insert(purchase)
        .values({
          userId: w.captain.userId,
          subtotalCents: 120_000,
          totalCents: 120_000,
        })
        .returning({ id: purchase.id });
      await db.insert(purchaseItem).values({
        purchaseId: open!.id,
        kind: "team_fee",
        teamSeasonId: w.aces.id,
        amountCents: 120_000,
        description: "Team fee",
      });
      expect(
        await offerCaptaincy(db, {
          teamSeasonId: w.aces.id,
          toUserId: w.mate.userId,
          actorId: w.captain.userId,
          now: NOW,
        }),
      ).toEqual(err("checkout_open"));
    });
  });

  it("closes an offer that no longer stands once the captain changed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const offered = await offerCaptaincy(db, {
        teamSeasonId: w.aces.id,
        toUserId: w.mate.userId,
        actorId: w.captain.userId,
        now: NOW,
      });
      if (!offered.ok) throw new Error(offered.error);
      // Meanwhile the league moved the captaincy by hand.
      await db
        .update(rosterMembership)
        .set({ role: "player" })
        .where(eq(rosterMembership.registrationId, w.captain.registrationId));
      await db
        .update(rosterMembership)
        .set({ role: "captain" })
        .where(eq(rosterMembership.registrationId, w.other.registrationId));
      expect(
        await answerCaptaincy(db, {
          handoffId: offered.value,
          userId: w.mate.userId,
          accept: true,
          now: NOW,
        }),
      ).toEqual(err("captain_changed"));
      expect((await teamCaptaincy(db, w.aces.id)).pending).toBeNull();
      expect(await roleOf(db, w.mate.userId)).toBe("player");
    });
  });

  it("stops waiting when either person deletes their account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const offered = await offerCaptaincy(db, {
        teamSeasonId: w.aces.id,
        toUserId: w.mate.userId,
        actorId: w.captain.userId,
        now: NOW,
      });
      if (!offered.ok) throw new Error(offered.error);
      expect(await deleteAccount(db, w.mate.userId, NOW)).toEqual(
        ok(undefined),
      );
      expect((await teamCaptaincy(db, w.aces.id)).pending).toBeNull();
    });
  });
});

describe("co-captains", () => {
  it("get the team's tools from the captain, and are told", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await setTeamRole(db, {
          teamSeasonId: w.aces.id,
          userId: w.mate.userId,
          role: "co_captain",
          actorId: w.captain.userId,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      const co = await loadSubject(db, w.mate.userId);
      const team = { teamSeasonId: w.aces.id };
      for (const tool of [
        "lineup.edit",
        "sub_request.post",
        "keep_off.manage",
        "payments.export",
      ] as const)
        expect(can(co, tool, team)).toBe(true);
      // But not the captaincy, nor the captain's spot.
      expect(can(co, "captaincy.manage", team)).toBe(false);
      expect(can(co, "roster.manage", { ...team, targetRole: "captain" })).toBe(
        false,
      );
      expect(await messagesTo(db, w.mate.userId)).toMatchObject([
        { template: "team_role", payload: { kind: "co_captain" } },
      ]);
      expect(await actions(db)).toEqual(["captaincy.add_co_captain"]);
    });
  });

  it("never change the captain's own role", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await setTeamRole(db, {
          teamSeasonId: w.aces.id,
          userId: w.captain.userId,
          role: "player",
          actorId: w.captain.userId,
          now: NOW,
        }),
      ).toEqual(err("is_captain"));
    });
  });

  it("can step down on their own, with nothing sent", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await setTeamRole(db, {
        teamSeasonId: w.aces.id,
        userId: w.mate.userId,
        role: "co_captain",
        actorId: w.captain.userId,
        now: NOW,
      });
      expect(
        await setTeamRole(db, {
          teamSeasonId: w.aces.id,
          userId: w.mate.userId,
          role: "player",
          actorId: w.mate.userId,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      expect(await roleOf(db, w.mate.userId)).toBe("player");
      expect(await messagesTo(db, w.mate.userId)).toHaveLength(1);
      expect(await actions(db)).toEqual([
        "captaincy.add_co_captain",
        "captaincy.remove_co_captain",
      ]);
    });
  });
});
