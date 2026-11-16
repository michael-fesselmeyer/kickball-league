import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { MoveInviteId, TeamId, TeamSeasonId, UserId } from "@/domain/ids";
import type { Audience } from "@/domain/move/move";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { message } from "../schema/message";
import { moveInterest, moveInvite } from "../schema/move";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { personalData } from "./account";
import { matcherInput } from "./free-agents";
import { addKeepOff, teamOfSeason } from "./keep-off";
import {
  answerMoveInvite,
  inviteOpenPlayers,
  moveInterestsForAdmins,
  myMoveInterest,
  myMoveInvites,
  purgeClearedMoves,
  recruitingSummary,
  recruitingTeam,
  setMoveInterest,
  withdrawMoveInterest,
} from "./move";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-10-01T12:00:00Z");
/** Next season's registration closes here; flags set before it clear. */
const CLOSES = new Date("2027-02-01T05:00:00Z");
const AFTER_CLOSE = new Date("2027-02-02T12:00:00Z");

/**
 * The messaging world as this season (Aces and Bees playing), plus next
 * season, open for registration: Aces is back with its captain, and Cats
 * is a new team recruiting. Ace 1 plays for Aces this season.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  await db
    .update(season)
    .set({
      status: "in_progress",
      registrationClosesAt: new Date("2026-08-25T00:00:00Z"),
    })
    .where(eq(season.id, w.season.id));
  const next = required(
    (
      await db
        .insert(season)
        .values({
          leagueId: w.leagueId,
          name: "Spring 2027",
          slug: `spring-${w.tag}`,
          status: "registration_open",
          startsOn: "2027-03-01",
          endsOn: "2027-05-01",
          registrationClosesAt: CLOSES,
          feeModel: "per_player",
          playerFeeCents: 8500,
          rosterMin: 1,
          rosterMax: 20,
        })
        .returning({ id: season.id, slug: season.slug })
    )[0],
    "season",
  );
  const aces = required(await teamOfSeason(db, w.aces.id), "aces");
  const bees = required(await teamOfSeason(db, w.bees.id), "bees");

  async function register(userId: UserId, kind: "team_member" | "free_agent") {
    return required(
      (
        await db
          .insert(registration)
          .values({ seasonId: next.id, userId, kind, status: "active" })
          .returning({ id: registration.id })
      )[0],
      "registration",
    ).id;
  }
  async function enter(teamId: TeamId) {
    return required(
      (
        await db
          .insert(teamSeason)
          .values({ teamId, seasonId: next.id })
          .returning({ id: teamSeason.id })
      )[0],
      "team season",
    ).id;
  }
  async function captain(teamSeasonId: TeamSeasonId, userId: UserId) {
    await db.insert(rosterMembership).values({
      teamSeasonId,
      registrationId: await register(userId, "team_member"),
      role: "captain",
      status: "active",
    });
  }
  async function newPerson(name: string): Promise<UserId> {
    return required(
      (
        await db
          .insert(user)
          .values({ name, email: `move-${name}-${w.tag}@example.test` })
          .returning({ id: user.id })
      )[0],
      "user",
    ).id;
  }

  const acesNext = await enter(aces.teamId);
  await captain(acesNext, w.aces.captain.userId);
  const cats = required(
    (
      await db
        .insert(team)
        .values({ leagueId: w.leagueId, name: "Cats", slug: `cats-${w.tag}` })
        .returning({ id: team.id })
    )[0],
    "team",
  );
  const catsNext = await enter(cats.id);
  const catsCaptain = await newPerson("cat-cap");
  await captain(catsNext, catsCaptain);

  const recruiting = async (teamSeasonId: TeamSeasonId, at = NOW) =>
    required(await recruitingTeam(db, teamSeasonId, at), "recruiting");
  const open = (
    p: Player | UserId,
    audience: Audience = "both",
    note: string | null = "Tuesdays work best",
  ) =>
    setMoveInterest(db, {
      userId: typeof p === "string" ? p : p.userId,
      leagueId: w.leagueId,
      audience,
      note,
      now: NOW,
    });
  const summary = async (teamSeasonId: TeamSeasonId, at = NOW) =>
    recruitingSummary(db, await recruiting(teamSeasonId, at), at);

  return {
    ...w,
    next,
    acesTeamId: aces.teamId,
    beesTeamId: bees.teamId,
    acesNext,
    catsNext,
    catsCaptain,
    ace1: w.aces.players[0]!,
    register,
    enter,
    newPerson,
    recruiting,
    open,
    summary,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const messagesTo = (db: Db, userIds: UserId[]) =>
  db
    .select({
      userId: message.userId,
      template: message.template,
      payload: message.payload,
    })
    .from(message)
    .where(
      and(
        inArray(message.userId, userIds),
        inArray(message.template, ["move_invite", "move_accepted"]),
      ),
    );

/** Every account on Aces, this season or next. */
const acesPeople = (w: World) => [
  w.aces.captain.userId,
  ...w.aces.players.map((p) => p.userId),
];

async function invite(
  db: Db,
  w: World,
  teamSeasonId: TeamSeasonId,
  message: string | null = "Friendly, Tuesdays",
) {
  return inviteOpenPlayers(db, {
    recruiting: await w.recruiting(teamSeasonId),
    actorId: w.catsCaptain,
    message,
    now: NOW,
  });
}

async function onlyInvite(
  db: Db,
  w: World,
  userId: UserId,
): Promise<MoveInviteId> {
  const invites = await myMoveInvites(db, userId, w.leagueId, NOW);
  expect(invites).toHaveLength(1);
  return invites[0]!.id;
}

describe("looking for a change", () => {
  it("is never counted by the player's own team, only by other recruiting teams", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      expect(await w.summary(w.acesNext)).toEqual({
        waiting: 0,
        invited: 0,
        accepted: [],
      });
      expect(await w.summary(w.catsNext)).toEqual({
        waiting: 1,
        invited: 0,
        accepted: [],
      });
      // Aces can't invite them either: nothing to send.
      expect(
        await inviteOpenPlayers(db, {
          recruiting: await w.recruiting(w.acesNext),
          actorId: w.aces.captain.userId,
          message: null,
          now: NOW,
        }),
      ).toBe(0);
      expect(
        await db
          .select()
          .from(moveInvite)
          .where(eq(moveInvite.seasonId, w.next.id)),
      ).toEqual([]);
    });
  });

  it("shows the player their own flag with when it clears", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await myMoveInterest(db, w.ace1.userId, w.leagueId, NOW),
      ).toBeNull();
      await w.open(w.ace1);
      expect(
        await myMoveInterest(db, w.ace1.userId, w.leagueId, NOW),
      ).toMatchObject({
        audience: "both",
        note: "Tuesdays work best",
        since: NOW,
        clearsAt: CLOSES,
      });
      // Nobody else's flag reads as theirs.
      expect(
        await myMoveInterest(db, w.aces.captain.userId, w.leagueId, NOW),
      ).toBeNull();
    });
  });

  it("follows the audience the player picked", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const admins = async () =>
        (await moveInterestsForAdmins(db, w.leagueId, NOW)).map(
          (r) => r.userId,
        );

      await w.open(w.ace1, "admins");
      expect((await w.summary(w.catsNext)).waiting).toBe(0);
      expect(await admins()).toEqual([w.ace1.userId]);

      await w.open(w.ace1, "captains");
      expect((await w.summary(w.catsNext)).waiting).toBe(1);
      expect(await admins()).toEqual([]);

      await w.open(w.ace1, "both");
      expect((await w.summary(w.catsNext)).waiting).toBe(1);
      const [row] = await moveInterestsForAdmins(db, w.leagueId, NOW);
      expect(row).toMatchObject({
        userId: w.ace1.userId,
        note: "Tuesdays work best",
        teams: ["Aces"],
      });
    });
  });

  it("reveals a name to a team only when the player accepts its invite", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      expect(await invite(db, w, w.catsNext)).toBe(1);
      // Sent: the team sees a count, still no name.
      expect(await w.summary(w.catsNext)).toEqual({
        waiting: 0,
        invited: 1,
        accepted: [],
      });
      // The invite reaches the player, and only them.
      expect(
        await messagesTo(db, [w.ace1.userId, w.catsCaptain, ...acesPeople(w)]),
      ).toEqual([
        {
          userId: w.ace1.userId,
          template: "move_invite",
          payload: expect.objectContaining({
            team: "Cats",
            message: "Friendly, Tuesdays",
          }),
        },
      ]);
      // Sending again invites nobody new.
      expect(await invite(db, w, w.catsNext)).toBe(0);

      const id = await onlyInvite(db, w, w.ace1.userId);
      expect(
        await answerMoveInvite(db, {
          id,
          userId: w.ace1.userId,
          accept: true,
          now: NOW,
        }),
      ).toEqual({ ok: true, value: undefined });
      const after = await w.summary(w.catsNext);
      expect(after.accepted).toEqual([
        { name: "ace-1", email: w.ace1.email, note: "Tuesdays work best" },
      ]);
      const toCaptain = await messagesTo(db, [w.catsCaptain]);
      expect(toCaptain).toEqual([
        {
          userId: w.catsCaptain,
          template: "move_accepted",
          payload: expect.objectContaining({ player: "ace-1", team: "Cats" }),
        },
      ]);
      // Never a word to their current team.
      expect(
        await messagesTo(
          db,
          acesPeople(w).filter((u) => u !== w.ace1.userId),
        ),
      ).toEqual([]);
    });
  });

  it("tells nobody about a no, and a no can become a yes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      await invite(db, w, w.catsNext);
      const id = await onlyInvite(db, w, w.ace1.userId);
      await answerMoveInvite(db, {
        id,
        userId: w.ace1.userId,
        accept: false,
        now: NOW,
      });
      expect(await w.summary(w.catsNext)).toEqual({
        waiting: 0,
        invited: 1,
        accepted: [],
      });
      expect(await messagesTo(db, [w.catsCaptain])).toEqual([]);
      await answerMoveInvite(db, {
        id,
        userId: w.ace1.userId,
        accept: true,
        now: NOW,
      });
      expect((await w.summary(w.catsNext)).accepted).toHaveLength(1);
      // A yes stands until they withdraw.
      expect(
        await answerMoveInvite(db, {
          id,
          userId: w.ace1.userId,
          accept: false,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "answered" });
    });
  });

  it("lets only the player answer their invite", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      await invite(db, w, w.catsNext);
      const id = await onlyInvite(db, w, w.ace1.userId);
      for (const other of [w.catsCaptain, w.aces.captain.userId])
        expect(
          await answerMoveInvite(db, {
            id,
            userId: other,
            accept: true,
            now: NOW,
          }),
        ).toEqual({ ok: false, error: "not_found" });
      expect((await w.summary(w.catsNext)).accepted).toEqual([]);
    });
  });

  it("hides an accepted name again when the player narrows the audience to admins", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      await invite(db, w, w.catsNext);
      const id = await onlyInvite(db, w, w.ace1.userId);
      await answerMoveInvite(db, {
        id,
        userId: w.ace1.userId,
        accept: true,
        now: NOW,
      });
      await w.open(w.ace1, "admins");
      expect((await w.summary(w.catsNext)).accepted).toEqual([]);
    });
  });

  it("takes the flag and every invite away when the player withdraws", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      await invite(db, w, w.catsNext);
      const id = await onlyInvite(db, w, w.ace1.userId);
      await answerMoveInvite(db, {
        id,
        userId: w.ace1.userId,
        accept: true,
        now: NOW,
      });
      expect(await withdrawMoveInterest(db, w.ace1.userId, w.leagueId)).toBe(
        true,
      );
      expect(
        await myMoveInterest(db, w.ace1.userId, w.leagueId, NOW),
      ).toBeNull();
      expect(await w.summary(w.catsNext)).toEqual({
        waiting: 0,
        invited: 0,
        accepted: [],
      });
      expect(
        await db
          .select()
          .from(moveInvite)
          .where(eq(moveInvite.seasonId, w.next.id)),
      ).toEqual([]);
      expect(await withdrawMoveInterest(db, w.ace1.userId, w.leagueId)).toBe(
        false,
      );
    });
  });

  it("clears itself when next season's registration closes, and starts over when set again", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      await invite(db, w, w.catsNext);
      expect(
        await myMoveInterest(db, w.ace1.userId, w.leagueId, AFTER_CLOSE),
      ).toBeNull();
      expect(
        await myMoveInvites(db, w.ace1.userId, w.leagueId, AFTER_CLOSE),
      ).toEqual([]);
      expect(await moveInterestsForAdmins(db, w.leagueId, AFTER_CLOSE)).toEqual(
        [],
      );
      // The season is no longer recruiting once its registration closed.
      expect(await recruitingTeam(db, w.catsNext, AFTER_CLOSE)).toBeNull();

      // Set again after the close: a fresh flag, without the old invites.
      await setMoveInterest(db, {
        userId: w.ace1.userId,
        leagueId: w.leagueId,
        audience: "both",
        note: null,
        now: AFTER_CLOSE,
      });
      expect(
        await myMoveInterest(db, w.ace1.userId, w.leagueId, AFTER_CLOSE),
      ).toMatchObject({ since: AFTER_CLOSE, clearsAt: null });
      expect(
        await myMoveInvites(db, w.ace1.userId, w.leagueId, AFTER_CLOSE),
      ).toEqual([]);
    });
  });

  it("purges cleared flags with their invites, and keeps the rest", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      await invite(db, w, w.catsNext);
      const mine = () =>
        db
          .select({ id: moveInterest.id })
          .from(moveInterest)
          .where(eq(moveInterest.leagueId, w.leagueId));
      await purgeClearedMoves(db, NOW);
      expect(await mine()).toHaveLength(1);
      await purgeClearedMoves(db, AFTER_CLOSE);
      expect(await mine()).toEqual([]);
      expect(
        await db
          .select()
          .from(moveInvite)
          .where(eq(moveInvite.seasonId, w.next.id)),
      ).toEqual([]);
    });
  });

  it("is hidden from both teams of a player on two teams", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // Ace 1 also plays for Bees on another night: a second season this fall.
      const tuesdays = required(
        (
          await db
            .insert(season)
            .values({
              leagueId: w.leagueId,
              name: "Fall Tuesdays 2026",
              slug: `fall-tue-${w.tag}`,
              status: "in_progress",
              startsOn: "2026-09-02",
              endsOn: "2026-11-02",
              registrationClosesAt: new Date("2026-08-26T00:00:00Z"),
              feeModel: "per_player",
              playerFeeCents: 8500,
              rosterMin: 1,
              rosterMax: 20,
            })
            .returning({ id: season.id })
        )[0],
        "season",
      );
      const beesTuesday = required(
        (
          await db
            .insert(teamSeason)
            .values({ teamId: w.beesTeamId, seasonId: tuesdays.id })
            .returning({ id: teamSeason.id })
        )[0],
        "team season",
      ).id;
      const ace1Tuesday = required(
        (
          await db
            .insert(registration)
            .values({
              seasonId: tuesdays.id,
              userId: w.ace1.userId,
              kind: "team_member",
              status: "active",
            })
            .returning({ id: registration.id })
        )[0],
        "registration",
      ).id;
      await db.insert(rosterMembership).values({
        teamSeasonId: beesTuesday,
        registrationId: ace1Tuesday,
        role: "player",
        status: "active",
      });
      // Bees is back next season too, recruiting.
      const beesNext = await w.enter(w.beesTeamId);
      await db.insert(rosterMembership).values({
        teamSeasonId: beesNext,
        registrationId: await w.register(w.bees.captain.userId, "team_member"),
        role: "captain",
        status: "active",
      });

      await w.open(w.ace1);
      expect((await w.summary(w.acesNext)).waiting).toBe(0);
      expect((await w.summary(beesNext)).waiting).toBe(0);
      expect((await w.summary(w.catsNext)).waiting).toBe(1);
      expect(await messagesTo(db, [w.bees.captain.userId])).toEqual([]);
    });
  });

  it("keeps a captain who is open to moving private from their own co-captains and team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.aces.captain);
      // Their own returning team never counts them.
      expect((await w.summary(w.acesNext)).waiting).toBe(0);
      // Another team does, and can invite them.
      expect((await w.summary(w.catsNext)).waiting).toBe(1);
      expect(await invite(db, w, w.catsNext)).toBe(1);
      expect(
        await messagesTo(
          db,
          acesPeople(w).filter((u) => u !== w.aces.captain.userId),
        ),
      ).toEqual([]);
      // They see their own flag; their teammates read nothing.
      expect(
        await myMoveInterest(db, w.aces.captain.userId, w.leagueId, NOW),
      ).not.toBeNull();
      for (const p of w.aces.players)
        expect(await myMoveInterest(db, p.userId, w.leagueId, NOW)).toBeNull();
    });
  });

  it("never counts or invites someone the team keeps off", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1);
      const cats = required(await teamOfSeason(db, w.catsNext), "cats");
      const listed = await addKeepOff(db, {
        teamId: cats.teamId,
        email: w.ace1.email,
        reason: null,
        actorId: w.catsCaptain,
        now: NOW,
      });
      expect(listed.ok).toBe(true);
      expect((await w.summary(w.catsNext)).waiting).toBe(0);
      expect(await invite(db, w, w.catsNext)).toBe(0);
    });
  });

  it("warns the player when the inviting team has a captain who plays with them", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // Cats' captain plays for Aces this season too.
      await db.insert(rosterMembership).values({
        teamSeasonId: w.aces.id,
        registrationId: required(
          (
            await db
              .insert(registration)
              .values({
                seasonId: w.season.id,
                userId: w.catsCaptain,
                kind: "team_member",
                status: "active",
              })
              .returning({ id: registration.id })
          )[0],
          "registration",
        ).id,
        role: "player",
        status: "active",
      });
      await w.open(w.ace1);
      // Cats' captain played for Aces, but Cats didn't: Cats may still count.
      await invite(db, w, w.catsNext);
      const [inv] = await myMoveInvites(db, w.ace1.userId, w.leagueId, NOW);
      expect(inv?.teammateCaptains).toBe(true);

      // Without that overlap there is no warning.
      const bee1 = w.bees.players[0]!;
      await w.open(bee1);
      await invite(db, w, w.catsNext);
      const [beeInvite] = await myMoveInvites(db, bee1.userId, w.leagueId, NOW);
      expect(beeInvite?.teammateCaptains).toBe(false);
    });
  });

  it("feeds the matcher only when admins may see it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const reg = await w.register(w.ace1.userId, "free_agent");
      await w.open(w.ace1, "captains");
      let input = required(await matcherInput(db, w.next.id), "input");
      expect(
        input.pool.find((p) => p.registrationId === reg)?.lookingForChange,
      ).toBe(false);
      expect(input.teams.flatMap((t) => t.movingOn ?? [])).toEqual([]);

      await w.open(w.ace1, "admins");
      input = required(await matcherInput(db, w.next.id), "input");
      expect(
        input.pool.find((p) => p.registrationId === reg)?.lookingForChange,
      ).toBe(true);
      expect(
        input.teams.find((t) => t.teamSeasonId === w.acesNext)?.movingOn,
      ).toEqual([reg]);
      expect(
        input.teams.find((t) => t.teamSeasonId === w.catsNext)?.movingOn,
      ).toEqual([]);
    });
  });

  it("is in the player's own export, never in a teammate's or captain's, and a captain's shows no names", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1, "both", "Only Tuesdays now");
      await invite(db, w, w.catsNext);
      const id = await onlyInvite(db, w, w.ace1.userId);
      await answerMoveInvite(db, {
        id,
        userId: w.ace1.userId,
        accept: false,
        now: NOW,
      });

      const own = await personalData(db, w.ace1.userId, NOW);
      expect(own?.teamChange.lookingForAChange).toMatchObject([
        { audience: "both", note: "Only Tuesdays now" },
      ]);
      expect(own?.teamChange.invitesReceived).toMatchObject([
        { team: "Cats", status: "declined" },
      ]);

      for (const other of [w.aces.captain.userId, w.aces.players[1]!.userId]) {
        const data = JSON.stringify(await personalData(db, other, NOW));
        expect(data).not.toContain("Only Tuesdays now");
      }
      const captain = await personalData(db, w.catsCaptain, NOW);
      expect(captain?.teamChange.invitesSent).toEqual([
        {
          team: "Cats",
          season: "Spring 2027",
          message: "Friendly, Tuesdays",
          sentAt: NOW,
          players: 1,
        },
      ]);
      const text = JSON.stringify(captain);
      expect(text).not.toContain("Only Tuesdays now");
      expect(text).not.toContain(w.ace1.email);
      expect(text).not.toContain("declined");
    });
  });

  it("writes nothing to the audit log, which admins read", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.open(w.ace1, "captains");
      await invite(db, w, w.catsNext);
      const id = await onlyInvite(db, w, w.ace1.userId);
      await answerMoveInvite(db, {
        id,
        userId: w.ace1.userId,
        accept: true,
        now: NOW,
      });
      await withdrawMoveInterest(db, w.ace1.userId, w.leagueId);
      expect(
        await db.select().from(auditLog).where(like(auditLog.action, "move%")),
      ).toEqual([]);
    });
  });

  it("doesn't recruit from a private event's season", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await db
        .update(season)
        .set({ visibility: "private" })
        .where(eq(season.id, w.next.id));
      expect(await recruitingTeam(db, w.catsNext, NOW)).toBeNull();
    });
  });
});
