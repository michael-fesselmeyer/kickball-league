import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import type { NewTeamRequestInput } from "@/domain/registration/new-team";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { teamFormationRequest } from "../schema/formation";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  approveNewTeamRequest,
  declineNewTeamRequest,
  myNewTeamRequest,
  newTeamRequestsBoard,
  pendingNewTeamCount,
  requestNewTeam,
  withdrawNewTeamRequest,
} from "./new-teams";
import {
  myRegistration,
  registerFreeAgent,
  registerTeam,
  type SeasonForRegistration,
  seasonForRegistration,
} from "./registration";
import type { Db } from "./schedule";

afterAll(closePool);

/** In the early-bird window, with registration open. */
const NOW = new Date("2027-02-15T17:00:00Z");
/** After the early bird ends. */
const LATER = new Date("2027-03-10T17:00:00Z");

async function world(db: Db, change: Partial<typeof season.$inferInsert> = {}) {
  const tag = Math.random().toString(36).slice(2, 8);
  const names = [
    ["Robin", "Example"],
    ["Sam", "Sample"],
    ["Alex", "Other"],
    ["Casey", "Admin"],
  ] as const;
  const people = await db
    .insert(user)
    .values(
      names.map(([first, last]) => ({
        name: `${first} ${last}`,
        email: `newteam-${first.toLowerCase()}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      firstName: names[i]![0],
      lastName: names[i]![1],
      globalRole: i === 3 ? ("admin" as const) : ("player" as const),
    })),
  );
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `newteam-${tag}` })
    .returning({ id: league.id });
  await db.insert(season).values({
    leagueId: lg!.id,
    name: "Spring 2027",
    slug: "spring-2027",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_team",
    teamFeeCents: 120_000,
    freeAgentFeeCents: 9000,
    earlyBirdEndsAt: new Date("2027-03-01T04:59:59Z"),
    earlyBirdDiscountCents: 1000,
    registrationOpensAt: new Date("2027-02-01T05:00:00Z"),
    registrationClosesAt: new Date("2027-03-23T03:59:59Z"),
    rosterMin: 12,
    rosterMax: 20,
    ...change,
  });
  const leagueId = lg!.id;
  const s = (await seasonForRegistration(
    db,
    leagueId,
    "spring-2027",
  )) as SeasonForRegistration;
  const [robin, sam, alex, admin] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  return { leagueId, season: s, robin, sam, alex, admin };
}

type World = Awaited<ReturnType<typeof world>>;

const ask = (
  name: string,
  change: Partial<NewTeamRequestInput> = {},
): NewTeamRequestInput => ({
  name,
  expectedSize: 14,
  paymentMode: "split",
  note: "Six of us from the Tuesday pickup game.",
  ...change,
});

async function request(
  db: Db,
  w: World,
  userId: UserId,
  name: string,
  change: Partial<NewTeamRequestInput> = {},
) {
  const result = await requestNewTeam(db, {
    leagueId: w.leagueId,
    season: w.season,
    userId,
    request: ask(name, change),
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Alex captains Base Invaders, paid in full; Sam plays on it. */
async function samOnATeam(db: Db, w: World, mode: "full" | "split" = "full") {
  const registered = await registerTeam(db, {
    ageConfirmed: true,
    leagueId: w.leagueId,
    season: w.season,
    userId: w.alex,
    team: {
      teamId: null,
      name: "Base Invaders",
      colorHex: null,
      paymentMode: mode,
      rosterSize: 14,
    },
    now: NOW,
  });
  if (!registered.ok) throw new Error(registered.error);
  const [reg] = await db
    .insert(registration)
    .values({
      seasonId: w.season.id,
      userId: w.sam,
      kind: "team_member",
      status: "active",
    })
    .returning({ id: registration.id });
  await db.insert(rosterMembership).values({
    teamSeasonId: registered.value.teamSeasonId,
    registrationId: reg!.id,
    role: "player",
    status: "active",
    startedAt: NOW,
  });
  return { oldTeam: registered.value.teamSeasonId, samReg: reg!.id };
}

const notices = (db: Db, userId: UserId) =>
  db
    .select({
      topic: message.topic,
      template: message.template,
      payload: message.payload,
    })
    .from(message)
    .where(eq(message.userId, userId));

describe("new-team requests", () => {
  it("records a request, shows it to the requester, and lets them withdraw it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await request(db, w, w.robin, "Kick Bottom");
      expect(await myNewTeamRequest(db, w.season.id, w.robin)).toMatchObject({
        id,
        proposedName: "Kick Bottom",
        expectedSize: 14,
        status: "pending",
        note: "Six of us from the Tuesday pickup game.",
      });
      expect(await pendingNewTeamCount(db, w.season.id)).toBe(1);

      // Only the requester can take it back, and only while it is open.
      expect(
        await withdrawNewTeamRequest(db, { requestId: id, userId: w.sam }),
      ).toEqual({ ok: false, error: "not_pending" });
      expect(
        await withdrawNewTeamRequest(db, { requestId: id, userId: w.robin }),
      ).toEqual({ ok: true, value: undefined });
      expect((await myNewTeamRequest(db, w.season.id, w.robin))?.status).toBe(
        "withdrawn",
      );
      expect(await pendingNewTeamCount(db, w.season.id)).toBe(0);
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audits.map((a) => a.action).sort()).toEqual([
        "team.request_new",
        "team.withdraw_request",
      ]);
    });
  });

  it("allows one open request per person and one claim on a name", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await request(db, w, w.robin, "Kick Bottom");
      const again = (userId: UserId, name: string) =>
        requestNewTeam(db, {
          leagueId: w.leagueId,
          season: w.season,
          userId,
          request: ask(name),
          now: NOW,
        });
      expect(await again(w.robin, "Other Name")).toEqual({
        ok: false,
        error: "pending",
      });
      // Same name in other words, from someone else.
      expect(await again(w.sam, "kick-bottom!")).toEqual({
        ok: false,
        error: "name_taken",
      });
      // A team that already exists in the league.
      await samOnATeam(db, w);
      expect(await again(w.sam, "Base Invaders")).toEqual({
        ok: false,
        error: "name_taken",
      });
    });
  });

  it("refuses captains and closed seasons", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await samOnATeam(db, w);
      expect(
        await requestNewTeam(db, {
          leagueId: w.leagueId,
          season: w.season,
          userId: w.alex,
          request: ask("Kick Bottom"),
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "captain" });
      expect(
        await requestNewTeam(db, {
          leagueId: w.leagueId,
          season: w.season,
          userId: w.robin,
          request: ask("Kick Bottom"),
          now: new Date("2027-03-24T12:00:00Z"),
        }),
      ).toEqual({ ok: false, error: "closed" });
    });
  });

  it("approval creates a forming team with the unregistered requester as captain", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await request(db, w, w.robin, "Kick Bottom");
      // Approved after the early bird: the price is still the one on the day they asked.
      const approved = await approveNewTeamRequest(db, {
        leagueId: w.leagueId,
        season: w.season,
        requestId: id,
        actorId: w.admin,
        now: LATER,
      });
      if (!approved.ok) throw new Error(approved.error);
      const mine = await myRegistration(db, w.season.id, w.robin);
      expect(mine).toMatchObject({
        kind: "team_member",
        status: "pending_waiver",
        team: {
          teamSeasonId: approved.value.teamSeasonId,
          teamStatus: "forming",
          role: "captain",
          teamName: "Kick Bottom",
          paymentMode: "split",
          // $1,190 after the early bird, over 14 players.
          shareCents: 8500,
          targetRosterSize: 14,
        },
      });
      expect(await myNewTeamRequest(db, w.season.id, w.robin)).toMatchObject({
        status: "approved",
      });
      expect(await notices(db, w.robin)).toEqual([
        {
          topic: "new_team",
          template: "new_team",
          payload: {
            kind: "approved",
            seasonName: "Spring 2027",
            seasonSlug: "spring-2027",
            team: "Kick Bottom",
          },
        },
      ]);
      // Answered once: a second approval or a decline is refused.
      expect(
        await approveNewTeamRequest(db, {
          leagueId: w.leagueId,
          season: w.season,
          requestId: id,
          actorId: w.admin,
          now: LATER,
        }),
      ).toEqual({ ok: false, error: "not_pending" });
      expect(
        await declineNewTeamRequest(db, {
          season: w.season,
          requestId: id,
          actorId: w.admin,
          reason: null,
          now: LATER,
        }),
      ).toEqual({ ok: false, error: "not_pending" });
    });
  });

  it("moves a rostered player off their team and tells that captain", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const { oldTeam, samReg } = await samOnATeam(db, w, "full");
      const id = await request(db, w, w.sam, "Kick Bottom", {
        paymentMode: "full",
      });
      const approved = await approveNewTeamRequest(db, {
        leagueId: w.leagueId,
        season: w.season,
        requestId: id,
        actorId: w.admin,
        now: NOW,
      });
      if (!approved.ok) throw new Error(approved.error);

      const spots = await db
        .select({
          teamSeasonId: rosterMembership.teamSeasonId,
          role: rosterMembership.role,
          status: rosterMembership.status,
        })
        .from(rosterMembership)
        .where(eq(rosterMembership.registrationId, samReg));
      expect(spots).toEqual(
        expect.arrayContaining([
          { teamSeasonId: oldTeam, role: "player", status: "removed" },
          {
            teamSeasonId: approved.value.teamSeasonId,
            role: "captain",
            status: "active",
          },
        ]),
      );
      // Sam was covered by the old captain's team fee, so now owes again,
      // and pays the new team's full fee as chosen.
      expect(await myRegistration(db, w.season.id, w.sam)).toMatchObject({
        status: "pending_payment",
        team: { role: "captain", paymentMode: "full" },
      });
      expect(await notices(db, w.alex)).toEqual([
        {
          topic: "new_team",
          template: "new_team",
          payload: {
            kind: "player_left",
            seasonName: "Spring 2027",
            seasonSlug: "spring-2027",
            team: "Kick Bottom",
            player: "Sam S.",
            leftTeam: "Base Invaders",
          },
        },
      ]);
      const [row] = await db
        .select({ left: teamFormationRequest.leftTeamSeasonId })
        .from(teamFormationRequest)
        .where(eq(teamFormationRequest.id, id));
      expect(row?.left).toBe(oldTeam);
    });
  });

  it("keeps a requester's own payment as their share, so the team splits", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const fa = await registerFreeAgent(db, {
        ageConfirmed: true,
        season: w.season,
        userId: w.robin,
        now: NOW,
      });
      if (!fa.ok) throw new Error(fa.error);
      await db
        .update(registration)
        .set({ status: "active" })
        .where(eq(registration.id, fa.value));
      const [paid] = await db
        .insert(purchase)
        .values({
          userId: w.robin,
          seasonId: w.season.id,
          status: "paid",
          subtotalCents: 9000,
          totalCents: 9000,
        })
        .returning({ id: purchase.id });
      await db.insert(purchaseItem).values({
        purchaseId: paid!.id,
        kind: "free_agent_fee",
        registrationId: fa.value,
        amountCents: 9000,
        description: "Free agent fee",
      });
      const id = await request(db, w, w.robin, "Kick Bottom", {
        paymentMode: "full",
      });
      const board = await newTeamRequestsBoard(db, w.season.id);
      expect(board[0]?.now).toEqual({
        registered: true,
        team: null,
        paid: true,
        paidOwnWay: true,
      });
      const approved = await approveNewTeamRequest(db, {
        leagueId: w.leagueId,
        season: w.season,
        requestId: id,
        actorId: w.admin,
        now: NOW,
      });
      if (!approved.ok) throw new Error(approved.error);
      expect(await myRegistration(db, w.season.id, w.robin)).toMatchObject({
        kind: "team_member",
        status: "active",
        team: { role: "captain", paymentMode: "split" },
      });
    });
  });

  it("re-checks the team limit and the name when approving", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db, { maxTeams: 1 });
      const id = await request(db, w, w.robin, "Kick Bottom");
      await samOnATeam(db, w);
      const approve = () =>
        approveNewTeamRequest(db, {
          leagueId: w.leagueId,
          season: { ...w.season, maxTeams: 1 },
          requestId: id,
          actorId: w.admin,
          now: NOW,
        });
      expect(await approve()).toEqual({ ok: false, error: "season_full" });
      // Meanwhile someone registered a team with the same name directly.
      const direct = await registerTeam(db, {
        ageConfirmed: true,
        leagueId: w.leagueId,
        season: { ...w.season, maxTeams: null },
        userId: w.admin,
        team: {
          teamId: null,
          name: "Kick Bottom",
          colorHex: null,
          paymentMode: "split",
          rosterSize: 14,
        },
        now: NOW,
      });
      expect(direct.ok).toBe(true);
      await db
        .update(teamSeason)
        .set({ status: "withdrawn" })
        .where(eq(teamSeason.seasonId, w.season.id));
      expect(await approve()).toEqual({ ok: false, error: "name_taken" });
    });
  });

  it("declines with a reason the requester hears", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await request(db, w, w.robin, "Kick Bottom");
      expect(
        await declineNewTeamRequest(db, {
          season: w.season,
          requestId: id,
          actorId: w.admin,
          reason: "The season is full.",
          now: NOW,
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(await myNewTeamRequest(db, w.season.id, w.robin)).toMatchObject({
        status: "declined",
        declineReason: "The season is full.",
      });
      expect(await notices(db, w.robin)).toEqual([
        {
          topic: "new_team",
          template: "new_team",
          payload: {
            kind: "declined",
            seasonName: "Spring 2027",
            seasonSlug: "spring-2027",
            team: "Kick Bottom",
            reason: "The season is full.",
          },
        },
      ]);
      // No team was created, and they may ask again.
      expect(await myRegistration(db, w.season.id, w.robin)).toBeNull();
      await request(db, w, w.robin, "Kick Bottom Again");
    });
  });

  it("lists open requests first with where each requester stands", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await samOnATeam(db, w, "split");
      const first = await request(db, w, w.robin, "Kick Bottom");
      await declineNewTeamRequest(db, {
        season: w.season,
        requestId: first,
        actorId: w.admin,
        reason: null,
        now: NOW,
      });
      await request(db, w, w.sam, "Sole Mates");
      const board = await newTeamRequestsBoard(db, w.season.id);
      expect(board.map((r) => [r.proposedName, r.status])).toEqual([
        ["Sole Mates", "pending"],
        ["Kick Bottom", "declined"],
      ]);
      expect(board[0]).toMatchObject({
        requester: { name: "Sam Sample" },
        now: {
          registered: true,
          team: { name: "Base Invaders", role: "player" },
          paid: true,
          paidOwnWay: false,
        },
      });
      expect(board[1]?.now).toBeNull();
    });
  });

  it("is in the requester's export, and deleting the account withdraws it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await request(db, w, w.robin, "Kick Bottom");
      const exported = await personalData(db, w.robin, NOW);
      expect(exported?.newTeamRequests).toEqual([
        expect.objectContaining({
          proposedName: "Kick Bottom",
          note: "Six of us from the Tuesday pickup game.",
          status: "pending",
        }),
      ]);
      expect(await deleteAccount(db, w.robin, NOW)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await pendingNewTeamCount(db, w.season.id)).toBe(0);
    });
  });
});
