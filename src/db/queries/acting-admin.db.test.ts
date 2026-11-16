import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { LeagueId, UserId } from "@/domain/ids";
import { actingAdmin } from "../schema/acting-admin";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league, leagueMember } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  actingPowersOf,
  endActingAdmin,
  grantActingAdmin,
  handoverCandidates,
  listActingAdmins,
  queueActingAdminNotices,
} from "./acting-admin";
import { deleteAccount } from "./account";
import { required } from "./rows";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";

afterAll(closePool);

const day = (n: number, hour = 0) => new Date(Date.UTC(2027, 3, n, hour, 0, 0));
const NOW = day(10, 12);

async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "Test League", slug: `act-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  async function person(name: string, role?: "player" | "admin" | "owner") {
    const u = required(
      (
        await db
          .insert(user)
          .values({ name, email: `${name}-${tag}@example.test` })
          .returning({ id: user.id })
      )[0],
      "user",
    );
    await db.insert(profile).values({ userId: u.id, firstName: name });
    if (role)
      await db
        .insert(leagueMember)
        .values({ leagueId: lg.id, userId: u.id, role });
    return u.id;
  }
  return {
    leagueId: lg.id,
    owner: await person("Olive", "owner"),
    otherOwner: await person("Otto", "owner"),
    admin: await person("Adele", "admin"),
    trusted: await person("Tess", "player"),
    other: await person("Rae", "player"),
    person,
  };
}

const grant = (
  db: Db,
  w: Awaited<ReturnType<typeof world>>,
  over: Partial<Parameters<typeof grantActingAdmin>[1]> = {},
) =>
  grantActingAdmin(db, {
    leagueId: w.leagueId,
    userId: w.trusted,
    powers: ["scores", "rainouts"],
    startsAt: day(9),
    endsAt: day(14),
    actorId: w.owner,
    now: NOW,
    ...over,
  });

const subjectAt = (db: Db, w: { leagueId: LeagueId }, id: UserId, at: Date) =>
  loadSubject(db, id, w.leagueId, at);

describe("acting admin handovers", () => {
  it("gives the powers in the dates and no more, through the matrix", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect((await grant(db, w)).ok).toBe(true);
      const during = await subjectAt(db, w, w.trusted, NOW);
      expect(during.globalRole).toBe("player");
      expect(during.acting).toEqual(["scores", "rainouts"]);
      expect(can(during, "score.override")).toBe(true);
      expect(can(during, "rainout.confirm")).toBe(true);
      expect(can(during, "refund.issue")).toBe(false);
      expect(can(during, "schedule.manage")).toBe(false);
      expect(can(during, "admins.manage")).toBe(false);
      // Someone the owner did not name gets nothing.
      const stranger = await subjectAt(db, w, w.other, NOW);
      expect(stranger.acting).toBeUndefined();
      expect(can(stranger, "score.override")).toBe(false);
    });
  });

  it("gives nothing before the start", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await grant(db, w, { startsAt: day(12), endsAt: day(14) });
      const before = await subjectAt(db, w, w.trusted, NOW);
      expect(before.acting).toBeUndefined();
      expect(can(before, "score.override")).toBe(false);
      const during = await subjectAt(db, w, w.trusted, day(12, 1));
      expect(can(during, "score.override")).toBe(true);
    });
  });

  it("stops at the end date, to the moment", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await grant(db, w, { startsAt: day(9), endsAt: day(11) });
      const last = new Date(day(11).getTime() - 1);
      expect(
        can(await subjectAt(db, w, w.trusted, last), "score.override"),
      ).toBe(true);
      const after = await subjectAt(db, w, w.trusted, day(11));
      expect(after.acting).toBeUndefined();
      expect(can(after, "score.override")).toBe(false);
      expect(await actingPowersOf(db, w.trusted, w.leagueId, day(15))).toEqual(
        [],
      );
    });
  });

  it("lets the owner end it early, at once, and records who", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const made = await grant(db, w);
      if (!made.ok) throw new Error("not granted");
      const ended = await endActingAdmin(db, {
        id: made.value.id,
        leagueId: w.leagueId,
        actorId: w.otherOwner,
        now: NOW,
      });
      expect(ended.ok).toBe(true);
      const after = await subjectAt(
        db,
        w,
        w.trusted,
        new Date(NOW.getTime() + 1),
      );
      expect(can(after, "score.override")).toBe(false);
      // A second end is refused, not silently repeated.
      expect(
        await endActingAdmin(db, {
          id: made.value.id,
          leagueId: w.leagueId,
          actorId: w.owner,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "already_over" });
      const trail = await db
        .select({ action: auditLog.action, actor: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, made.value.id));
      expect(trail.map((t) => t.action).sort()).toEqual([
        "acting_admin.end",
        "acting_admin.grant",
      ]);
      expect(trail.find((t) => t.action === "acting_admin.end")?.actor).toBe(
        w.otherOwner,
      );
    });
  });

  it("adds up an overlapping second handover and ends each on its own", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await grant(db, w, {
        powers: ["scores"],
        startsAt: day(9),
        endsAt: day(12),
      });
      const second = await grant(db, w, {
        powers: ["schedule"],
        startsAt: day(10),
        endsAt: day(15),
      });
      if (!second.ok) throw new Error("not granted");
      const both = await subjectAt(db, w, w.trusted, NOW);
      expect(both.acting).toEqual(["scores", "schedule"]);
      // After the first ends by date, only the second remains.
      const later = await subjectAt(db, w, w.trusted, day(13));
      expect(later.acting).toEqual(["schedule"]);
      expect(can(later, "score.override")).toBe(false);
      expect(can(later, "schedule.manage")).toBe(true);
      // Ending the second early leaves the first running.
      await endActingAdmin(db, {
        id: second.value.id,
        leagueId: w.leagueId,
        actorId: w.owner,
        now: NOW,
      });
      const now2 = await subjectAt(
        db,
        w,
        w.trusted,
        new Date(NOW.getTime() + 1),
      );
      expect(now2.acting).toEqual(["scores"]);
    });
  });

  it("ends the access when the acting admin's account is deleted", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const trusted = await w.person("Gone", "player");
      await grant(db, w, { userId: trusted });
      expect((await actingPowersOf(db, trusted, w.leagueId, NOW)).length).toBe(
        2,
      );
      const result = await deleteAccount(db, trusted, NOW);
      expect(result.ok).toBe(true);
      expect(await actingPowersOf(db, trusted, w.leagueId, NOW)).toEqual([]);
      const [row] = await db
        .select({ endedAt: actingAdmin.endedAt })
        .from(actingAdmin)
        .where(eq(actingAdmin.userId, trusted));
      expect(row?.endedAt).not.toBeNull();
      // What they did stays: the audit rows name the anonymized account.
      const rows = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.action, "acting_admin.grant"));
      expect(rows.length).toBe(1);
    });
  });

  it("keeps an acting admin's own audit entries under their name", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await grant(db, w);
      const subject = await subjectAt(db, w, w.trusted, NOW);
      expect(can(subject, "score.override")).toBe(true);
      // The action the acting admin takes records them as the actor, as any admin's does.
      await db.insert(auditLog).values({
        leagueId: w.leagueId,
        actorId: subject.userId as UserId,
        action: "score.override",
        entityType: "game",
        entityId: w.leagueId,
      });
      const [row] = await db
        .select({ actor: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.action, "score.override"));
      expect(row?.actor).toBe(w.trusted);
    });
  });

  it("refuses what an owner may not grant", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const refusal = async (over: Parameters<typeof grant>[2]) => {
        const r = await grant(db, w, over);
        return r.ok ? null : r.error;
      };
      expect(await refusal({ userId: w.admin })).toBe("already_staff");
      expect(await refusal({ userId: w.otherOwner })).toBe("already_staff");
      expect(await refusal({ powers: [] })).toBe("no_powers");
      expect(await refusal({ powers: ["owner"] })).toBe("no_powers");
      expect(await refusal({ endsAt: day(9) })).toBe("bad_dates");
      expect(await refusal({ startsAt: day(1), endsAt: day(2) })).toBe(
        "in_the_past",
      );
      expect(
        await refusal({
          userId: "00000000-0000-4000-8000-000000000000" as UserId,
        }),
      ).toBe("not_a_player");
      const none = await db.select().from(actingAdmin);
      expect(none).toEqual([]);
    });
  });

  it("gives nothing in another league", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const other = required(
        (
          await db
            .insert(league)
            .values({
              name: "Other",
              slug: `oth-${Math.random().toString(36).slice(2, 8)}`,
            })
            .returning({ id: league.id })
        )[0],
        "league",
      );
      await grant(db, w);
      const elsewhere = await loadSubject(db, w.trusted, other.id, NOW);
      expect(elsewhere.acting).toBeUndefined();
      expect(can(elsewhere, "score.override")).toBe(false);
    });
  });

  it("never lifts an admin or owner's role, and does not list them as candidates", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const candidates = await handoverCandidates(db, w.leagueId);
      const ids = candidates.map((c) => c.userId);
      expect(ids).toContain(w.trusted);
      expect(ids).not.toContain(w.admin);
      expect(ids).not.toContain(w.owner);
      // A person with a profile and no role row in the league is a player.
      const newcomer = await w.person("Nell");
      expect(
        (await handoverCandidates(db, w.leagueId)).map((c) => c.userId),
      ).toContain(newcomer);
      // A grant made before someone was promoted adds nothing to their role.
      await grant(db, w);
      await db
        .update(leagueMember)
        .set({ role: "admin" })
        .where(
          and(
            eq(leagueMember.userId, w.trusted),
            eq(leagueMember.leagueId, w.leagueId),
          ),
        );
      const promoted = await subjectAt(db, w, w.trusted, NOW);
      expect(promoted.globalRole).toBe("admin");
      expect(promoted.acting).toBeUndefined();
    });
  });
});

describe("handover notices", () => {
  const sent = (db: Db) =>
    db
      .select({
        userId: message.userId,
        payload: message.payload,
        template: message.template,
      })
      .from(message)
      .where(eq(message.template, "acting_admin"));

  it("tells the acting admin and every owner once when it starts and once when it ends", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await grant(db, w, { startsAt: day(11), endsAt: day(13) });
      // Not started yet: nothing is sent.
      expect(await queueActingAdminNotices(db, NOW)).toBe(0);
      // Started: the person and both owners, not the admin or others.
      expect(await queueActingAdminNotices(db, day(11, 1))).toBe(3);
      expect(await queueActingAdminNotices(db, day(11, 2))).toBe(0);
      const started = await sent(db);
      expect(started.map((m) => m.userId).sort()).toEqual(
        [w.trusted, w.owner, w.otherOwner].sort(),
      );
      expect(
        started.every(
          (m) => (m.payload as { kind: string }).kind === "started",
        ),
      ).toBe(true);
      // Ended by date.
      expect(await queueActingAdminNotices(db, day(13, 1))).toBe(3);
      expect(await queueActingAdminNotices(db, day(14))).toBe(0);
      expect((await sent(db)).length).toBe(6);
    });
  });

  it("says it ended early when an owner ends it, and sends nothing for one revoked before it began", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const running = await grant(db, w);
      if (!running.ok) throw new Error("not granted");
      await queueActingAdminNotices(db, NOW);
      await endActingAdmin(db, {
        id: running.value.id,
        leagueId: w.leagueId,
        actorId: w.owner,
        now: day(11),
      });
      expect(await queueActingAdminNotices(db, day(11))).toBe(3);
      const kinds = (await sent(db)).map(
        (m) => (m.payload as { kind: string }).kind,
      );
      expect(kinds.filter((k) => k === "ended_early").length).toBe(3);

      const future = await grant(db, w, {
        userId: w.other,
        startsAt: day(20),
        endsAt: day(22),
      });
      if (!future.ok) throw new Error("not granted");
      await endActingAdmin(db, {
        id: future.value.id,
        leagueId: w.leagueId,
        actorId: w.owner,
        now: day(12),
      });
      const before = (await sent(db)).length;
      expect(await queueActingAdminNotices(db, day(12))).toBe(0);
      expect(await queueActingAdminNotices(db, day(30))).toBe(0);
      expect((await sent(db)).length).toBe(before);
    });
  });
});

describe("the handover list", () => {
  it("shows what is running or coming first, then recent ended ones", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await grant(db, w, { startsAt: day(1), endsAt: day(5), now: day(1) });
      await grant(db, w, { startsAt: day(12), endsAt: day(14) });
      await grant(db, w, { userId: w.other });
      const rows = await listActingAdmins(db, w.leagueId, NOW);
      expect(rows.map((r) => r.status)).toEqual([
        "active",
        "upcoming",
        "ended",
      ]);
      expect(rows[0]?.name).toBe("Rae");
    });
  });
});
