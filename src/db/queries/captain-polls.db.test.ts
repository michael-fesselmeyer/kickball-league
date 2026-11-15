import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { NewCaptainPoll } from "@/domain/captain-polls/captain-polls";
import type { CaptainPollId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { captainPollVote } from "../schema/captain-poll";
import { message } from "../schema/message";
import { rosterMembership, teamSeason } from "../schema/team";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  adminPoll,
  captainBallots,
  castVote,
  closePollNow,
  openPoll,
  pollsWaiting,
  queueReminders,
  removePoll,
  seasonPolls,
  teamsWithoutVote,
} from "./captain-polls";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-15T16:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

async function world(db: Db) {
  const w = await messagingWorld(db);
  /** Makes an existing player of a team its co-captain. */
  const coCaptain = async (p: Player) => {
    await db
      .update(rosterMembership)
      .set({ role: "co_captain" })
      .where(eq(rosterMembership.registrationId, p.registrationId));
  };
  const pollOf = (over: Partial<NewCaptainPoll> = {}) =>
    openPoll(db, {
      seasonId: w.season.id,
      actorId: w.aces.captain.userId,
      poll: {
        title: "Playoff innings?",
        detail: "",
        options: ["Five", "Seven", "Nine"],
        includeCoCaptains: false,
        results: "after_voting",
        opensAt: hours(-1),
        closesAt: hours(48),
        ...over,
      },
    });
  return { ...w, coCaptain, pollOf };
}

async function optionIds(db: Db, id: CaptainPollId) {
  const found = await adminPoll(db, id, NOW);
  return found!.options.map((o) => o.id);
}

describe("opening a poll", () => {
  it("invites each captain once, naming their team, and audits it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.pollOf();
      const sent = await db
        .select({ userId: message.userId, payload: message.payload })
        .from(message)
        .where(eq(message.template, "captain_poll"));
      expect(sent.map((m) => m.userId).sort()).toEqual(
        [w.aces.captain.userId, w.bees.captain.userId].sort(),
      );
      expect(sent[0]?.payload).toMatchObject({ kind: "new" });
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, id));
      expect(audits.map((a) => a.action)).toEqual(["captain_poll.open"]);
    });
  });
});

describe("voting", () => {
  it("counts one vote per team and lets a captain change it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.pollOf();
      const [five, seven] = await optionIds(db, id);
      const cast = (
        option: typeof five,
        team = w.aces.id,
        who = w.aces.captain,
      ) =>
        castVote(db, {
          pollId: id,
          teamSeasonId: team,
          optionId: option!,
          voterId: who.userId,
          now: NOW,
        });
      expect((await cast(five)).ok).toBe(true);
      expect((await cast(seven)).ok).toBe(true);
      const found = await adminPoll(db, id, NOW);
      expect(found?.voted).toBe(1);
      expect(found?.options.map((o) => o.votes)).toEqual([0, 1, 0]);
      expect(await teamsWithoutVote(db, id)).toBe(1);
    });
  });

  it("lets the last of two captains of one team win, when co-captains are included", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const co = w.aces.players[0]!;
      await w.coCaptain(co);
      const id = await w.pollOf({ includeCoCaptains: true });
      const [five, seven] = await optionIds(db, id);
      const vote = (option: typeof five, who: Player) =>
        castVote(db, {
          pollId: id,
          teamSeasonId: w.aces.id,
          optionId: option!,
          voterId: who.userId,
          now: NOW,
        });
      await vote(five, w.aces.captain);
      await vote(seven, co);
      const rows = await db.select().from(captainPollVote);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ optionId: seven, voterId: co.userId });
      const ballots = await captainBallots(db, w.aces.captain.userId, NOW);
      expect(ballots[0]?.teams[0]).toMatchObject({
        myOptionId: seven,
        changedByOther: true,
      });
    });
  });

  it("refuses a co-captain unless the poll includes them, and players and other teams' captains", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const co = w.aces.players[0]!;
      await w.coCaptain(co);
      const id = await w.pollOf();
      const [five] = await optionIds(db, id);
      const vote = (who: Player, team = w.aces.id) =>
        castVote(db, {
          pollId: id,
          teamSeasonId: team,
          optionId: five!,
          voterId: who.userId,
          now: NOW,
        });
      expect(await vote(co)).toEqual({ ok: false, error: "not_a_voter" });
      expect(await vote(w.aces.players[1]!)).toEqual({
        ok: false,
        error: "not_a_voter",
      });
      expect(await vote(w.bees.captain)).toEqual({
        ok: false,
        error: "not_a_voter",
      });
      expect(await vote(w.freeAgent)).toEqual({
        ok: false,
        error: "not_a_voter",
      });
    });
  });

  it("refuses a vote after the closing time, before opening and for another poll's option", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.pollOf();
      const other = await w.pollOf({ title: "Other" });
      const [five] = await optionIds(db, id);
      const [foreign] = await optionIds(db, other);
      const vote = (option: typeof five, now: Date, pollId = id) =>
        castVote(db, {
          pollId,
          teamSeasonId: w.aces.id,
          optionId: option!,
          voterId: w.aces.captain.userId,
          now,
        });
      expect(await vote(five, hours(48))).toEqual({
        ok: false,
        error: "not_open",
      });
      expect(await vote(five, hours(-2))).toEqual({
        ok: false,
        error: "not_open",
      });
      expect(await vote(foreign, NOW)).toEqual({
        ok: false,
        error: "not_an_option",
      });
      const gone = "00000000-0000-4000-8000-000000000000" as CaptainPollId;
      expect(await vote(five, NOW, gone)).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });

  it("counts a team added after the poll opened, and drops a withdrawn team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.pollOf();
      const cats = await w.entry("Cats");
      const cat = await w.person("cat-1");
      await w.join(cats, cat, "captain");
      const [five] = await optionIds(db, id);
      const result = await castVote(db, {
        pollId: id,
        teamSeasonId: cats,
        optionId: five!,
        voterId: cat.userId,
        now: NOW,
      });
      expect(result.ok).toBe(true);
      expect((await adminPoll(db, id, NOW))?.teams).toHaveLength(3);
      await db
        .update(teamSeason)
        .set({ status: "withdrawn" })
        .where(eq(teamSeason.id, cats));
      const after = await adminPoll(db, id, NOW);
      expect(after?.teams).toHaveLength(2);
      expect(after?.options[0]?.votes).toBe(0);
      expect(
        await castVote(db, {
          pollId: id,
          teamSeasonId: cats,
          optionId: five!,
          voterId: cat.userId,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "team_not_in_poll" });
    });
  });
});

describe("what a captain sees", () => {
  it("holds totals until their team votes, or until close, as the admin chose", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const after = await w.pollOf({ title: "After" });
      const atClose = await w.pollOf({
        title: "At close",
        results: "at_close",
      });
      const cap = w.aces.captain;
      const find = async (title: string, now = NOW) =>
        (await captainBallots(db, cap.userId, now)).find(
          (b) => b.poll.title === title,
        )!;
      expect((await find("After")).results).toBeNull();
      for (const id of [after, atClose]) {
        const [five] = await optionIds(db, id);
        await castVote(db, {
          pollId: id,
          teamSeasonId: w.aces.id,
          optionId: five!,
          voterId: cap.userId,
          now: NOW,
        });
      }
      expect((await find("After")).results?.total).toBe(1);
      expect((await find("At close")).results).toBeNull();
      const later = hours(49);
      expect((await find("At close", later)).results?.total).toBe(1);
    });
  });

  it("lists nothing for a player, and only closed polls from the last two weeks", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.pollOf();
      expect(await captainBallots(db, w.aces.players[0]!.userId, NOW)).toEqual(
        [],
      );
      expect(await pollsWaiting(db, w.aces.captain.userId, NOW)).toBe(1);
      expect(
        await captainBallots(db, w.aces.captain.userId, hours(48 + 15 * 24)),
      ).toEqual([]);
    });
  });
});

describe("closing and removing", () => {
  it("closes early once, then refuses; removing takes the votes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = await w.pollOf();
      const [five] = await optionIds(db, id);
      await castVote(db, {
        pollId: id,
        teamSeasonId: w.aces.id,
        optionId: five!,
        voterId: w.aces.captain.userId,
        now: NOW,
      });
      const close = () =>
        closePollNow(db, {
          pollId: id,
          seasonId: w.season.id,
          actorId: w.aces.captain.userId,
          now: NOW,
        });
      expect((await close()).ok).toBe(true);
      expect(await close()).toEqual({ ok: false, error: "not_open" });
      expect(
        await castVote(db, {
          pollId: id,
          teamSeasonId: w.bees.id,
          optionId: five!,
          voterId: w.bees.captain.userId,
          now: hours(1),
        }),
      ).toEqual({ ok: false, error: "not_open" });
      expect((await seasonPolls(db, w.season.id, hours(1)))[0]).toMatchObject({
        state: "closed",
        voted: 1,
        teams: 2,
      });
      await removePoll(db, {
        pollId: id,
        seasonId: w.season.id,
        actorId: w.aces.captain.userId,
      });
      expect(await db.select().from(captainPollVote)).toEqual([]);
      const actions = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id)));
      expect(actions.map((a) => a.action).sort()).toEqual([
        "captain_poll.close",
        "captain_poll.open",
        "captain_poll.remove",
      ]);
    });
  });
});

describe("reminders", () => {
  it("go to teams that have not voted, once a day, and only near closing", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const soon = await w.pollOf({ title: "Soon", closesAt: hours(10) });
      await w.pollOf({ title: "Far", closesAt: hours(72) });
      const [five] = await optionIds(db, soon);
      await castVote(db, {
        pollId: soon,
        teamSeasonId: w.aces.id,
        optionId: five!,
        voterId: w.aces.captain.userId,
        now: NOW,
      });
      const run = (extra = {}) =>
        queueReminders(db, {
          leagueId: w.leagueId,
          now: NOW,
          today: "2026-09-15",
          ...extra,
        });
      expect(await run()).toBe(1);
      expect(await run()).toBe(0);
      const reminders = await db
        .select({ userId: message.userId, payload: message.payload })
        .from(message)
        .where(
          eq(
            message.dedupeKey,
            `captain_poll/${soon}/reminder/2026-09-15/${w.bees.captain.userId}`,
          ),
        );
      expect(reminders).toHaveLength(1);
      expect(reminders[0]?.payload).toMatchObject({
        kind: "reminder",
        teams: "Bees",
      });
      // An admin's reminder for the far poll reaches both teams.
      const far = (await seasonPolls(db, w.season.id, NOW)).find(
        (p) => p.title === "Far",
      )!;
      expect(await run({ pollId: far.id })).toBe(2);
    });
  });

  it("skip a closed poll", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.pollOf({ closesAt: hours(5) });
      expect(
        await queueReminders(db, {
          leagueId: w.leagueId,
          now: hours(6),
          today: "2026-09-15",
        }),
      ).toBe(0);
    });
  });
});
