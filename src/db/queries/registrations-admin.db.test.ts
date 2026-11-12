import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  parseId,
  type RegistrationId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import { checkoutItems } from "@/domain/registration/checkout";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { payment } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { recordOffAppPayment } from "./payments";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "./registration";
import {
  placeFreeAgent,
  registrationForPayment,
  registrationsBoard,
} from "./registrations-admin";
import type { Db } from "./schedule";

afterAll(closePool);

/** An ID that exists nowhere. */
function missingId<Id extends RegistrationId | TeamSeasonId>(): Id {
  const id = parseId<Id>(randomUUID());
  if (!id) throw new Error("randomUUID gave a non-UUID");
  return id;
}

const NOW = new Date("2027-02-15T17:00:00Z");

async function world(db: Db, rosterMax = 20) {
  const tag = Math.random().toString(36).slice(2, 8);
  const names = ["Robin", "Sam", "Alex"];
  const people = await db
    .insert(user)
    .values(
      names.map((n) => ({ name: n, email: `adm-${n}-${tag}@example.test` })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      firstName: names[i] ?? "",
      lastName: "Example",
    })),
  );
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `adm-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  await db.insert(season).values({
    leagueId: lg.id,
    name: "Spring",
    slug: "spring",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    freeAgentFeeCents: 9000,
    rosterMin: 1,
    rosterMax,
  });
  const leagueId = lg.id;
  const s = await seasonForRegistration(db, leagueId, "spring");
  if (!s) throw new Error("no season");
  const [captain, agent, admin] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
  ];
  const team = await registerTeam(db, {
    leagueId,
    season: s,
    userId: captain,
    team: {
      teamId: null,
      name: "Kick Bottom",
      colorHex: null,
      paymentMode: "split",
      rosterSize: 2,
    },
    now: NOW,
  });
  if (!team.ok) throw new Error(team.error);
  const fa = await registerFreeAgent(db, {
    season: s,
    userId: agent,
    now: NOW,
  });
  if (!fa.ok) throw new Error(fa.error);
  return {
    season: s,
    captain,
    agent,
    admin,
    teamSeasonId: team.value.teamSeasonId,
    agentRegistration: fa.value,
  };
}

describe("the registrations board", () => {
  it("lists teams with their rosters and the free-agent pool", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const board = await registrationsBoard(db, w.season.id);
      expect(board.teams.map((t) => [t.name, t.shareCents])).toEqual([
        ["Kick Bottom", 60_000],
      ]);
      expect(
        board.teams[0]?.members.map((m) => [m.name, m.role, m.signed, m.paid]),
      ).toEqual([["Robin Example", "captain", false, false]]);
      expect(board.freeAgents.map((m) => [m.name, m.role])).toEqual([
        ["Sam Example", null],
      ]);
    });
  });

  it("places a free agent on a team, once, within the roster limit", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, 2);
      const place = (registrationId = w.agentRegistration) =>
        placeFreeAgent(db, {
          seasonId: w.season.id,
          registrationId,
          teamSeasonId: w.teamSeasonId,
          actorId: w.admin,
          now: NOW,
        });
      expect(await place()).toEqual({ ok: true, value: undefined });
      expect(await place()).toEqual({ ok: false, error: "already_on_team" });
      const board = await registrationsBoard(db, w.season.id);
      expect(board.freeAgents).toEqual([]);
      expect(board.teams[0]?.members.map((m) => m.name)).toEqual([
        "Robin Example",
        "Sam Example",
      ]);
      const [entry] = await db
        .select({ kind: registration.kind })
        .from(registration)
        .where(eq(registration.id, w.agentRegistration));
      expect(entry?.kind).toBe("team_member");

      // The team is now full.
      const third = await registerFreeAgent(db, {
        season: w.season,
        userId: w.admin,
        now: NOW,
      });
      if (!third.ok) throw new Error(third.error);
      expect(await place(third.value)).toEqual({ ok: false, error: "full" });
      expect(
        await placeFreeAgent(db, {
          seasonId: w.season.id,
          registrationId: third.value,
          teamSeasonId: missingId<TeamSeasonId>(),
          actorId: w.admin,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "unknown_team" });
    });
  });
});

describe("off-app payments", () => {
  it("settles a registration paid in cash, with who recorded it and why", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await db
        .update(registration)
        .set({ status: "pending_payment" })
        .where(eq(registration.id, w.agentRegistration));
      const reg = await registrationForPayment(
        db,
        w.season.id,
        w.agentRegistration,
      );
      if (!reg) throw new Error("no registration");
      const items = checkoutItems(w.season, reg, NOW);
      if (!items.ok) throw new Error(items.error);
      await recordOffAppPayment(db, {
        userId: reg.userId,
        seasonId: w.season.id,
        registrationId: w.agentRegistration,
        items: items.items,
        method: "cash",
        note: "  Paid at the field  ",
        actorId: w.admin,
        now: NOW,
      });
      const [paid] = await db
        .select({
          method: payment.method,
          amount: payment.amountCents,
          note: payment.note,
          recordedBy: payment.recordedBy,
          intent: payment.stripePaymentIntentId,
        })
        .from(payment)
        .innerJoin(registration, eq(registration.id, w.agentRegistration));
      expect(paid).toEqual({
        method: "cash",
        amount: 9000,
        note: "Paid at the field",
        recordedBy: w.admin,
        intent: null,
      });
      const board = await registrationsBoard(db, w.season.id);
      expect(board.freeAgents[0]).toMatchObject({ paid: true, paidBy: "cash" });
      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.actorId, w.admin));
      expect(audit.map((a) => a.action)).toEqual(["payment.record_offline"]);
      expect(
        await registrationForPayment(db, w.season.id, missingId()),
      ).toBeNull();
    });
  });
});
