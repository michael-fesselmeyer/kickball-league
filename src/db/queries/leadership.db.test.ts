import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { LeadershipCheckInId, UserId } from "@/domain/ids";
import { DAY_MS } from "@/domain/leadership/leadership";
import { auditLog } from "../schema/audit";
import { captainHandoff } from "../schema/captaincy";
import {
  leadershipBallotOption,
  leadershipCandidate,
  leadershipCheckIn,
  leadershipParticipation,
} from "../schema/leadership";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership } from "../schema/team";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  advanceCheckIns,
  answerSuggestion,
  captainChooses,
  castVote,
  closeByLeague,
  leadershipFor,
  myLeadership,
  openCheckIns,
  pauseCheckIn,
  resumeCheckIn,
  seasonLeadership,
  submitCheckIn,
} from "./leadership";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-11-02T15:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * DAY_MS);
const nothing = { volunteer: [], suggest: null, steppingDown: false } as const;

/**
 * Aces: a captain and five players (six on the roster, so a 60% quorum
 * needs four). The season has finished.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const more = [
    await w.person("ace-3"),
    await w.person("ace-4"),
    await w.person("ace-5"),
  ];
  for (const p of more) await w.join(w.aces.id, p);
  const [cap, a, b, c, d, e] = [w.aces.captain, ...w.aces.players, ...more] as [
    Player,
    Player,
    Player,
    Player,
    Player,
    Player,
  ];
  await db.insert(profile).values(
    [cap, a, b, c, d, e].map((p, i) => ({
      userId: p.userId,
      firstName: ["Cap", "Ari", "Bo", "Cy", "Di", "Ed"][i]!,
      lastName: "Example",
    })),
  );
  await db
    .update(season)
    .set({ status: "completed" })
    .where(eq(season.id, w.season.id));
  const opened = await openCheckIns(db, {
    seasonId: w.season.id,
    days: 7,
    actorId: cap.userId,
    now: NOW,
  });
  if (!opened.ok) throw new Error(opened.error);
  const [row] = await db
    .select({ id: leadershipCheckIn.id })
    .from(leadershipCheckIn)
    .where(eq(leadershipCheckIn.teamSeasonId, w.aces.id));
  const id = row!.id;
  const checkIn = (userId: UserId, choice: Parameters<typeof submitCheckIn>[1]["choice"] = nothing, now = NOW) =>
    submitCheckIn(db, { checkInId: id, userId, choice, now });
  const vote = async (userId: UserId, forUser: UserId, now = day(8)) => {
    const [option] = await db
      .select({ id: leadershipBallotOption.id })
      .from(leadershipBallotOption)
      .where(
        and(
          eq(leadershipBallotOption.checkInId, id),
          eq(leadershipBallotOption.userId, forUser),
        ),
      );
    return castVote(db, { checkInId: id, userId, optionId: option!.id, now });
  };
  return { ...w, cap, a, b, c, d, e, id, checkIn, vote, opened: opened.value };
}

const stateOf = async (db: Db, id: LeadershipCheckInId) => {
  const [row] = await db
    .select()
    .from(leadershipCheckIn)
    .where(eq(leadershipCheckIn.id, id));
  return row!;
};

const messagesTo = (db: Db, userId: UserId) =>
  db
    .select({ template: message.template, payload: message.payload })
    .from(message)
    .where(
      and(
        eq(message.userId, userId),
        eq(message.channel, "email"),
        like(message.template, "leadership%"),
      ),
    );

const allMessages = (db: Db) =>
  db
    .select({ id: message.id })
    .from(message)
    .where(like(message.template, "leadership%"));

const leadershipAudit = (db: Db) =>
  db
    .select({
      action: auditLog.action,
      entityId: auditLog.entityId,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(like(auditLog.action, "leadership.%"));

/** The transactions that last wrote each row: one, for every row alike. */
const writers = async (db: Db, table: "candidate" | "option", id: string) => {
  const rows = await db.execute<{ xmin: string }>(
    table === "candidate"
      ? sql`select distinct xmin::text as xmin from leadership_candidate where check_in_id = ${id}`
      : sql`select distinct xmin::text as xmin from leadership_ballot_option where check_in_id = ${id}`,
  );
  return rows.rows.length;
};

/** Everyone but the captain checks in; `b` volunteers for captain. */
async function toBallot(db: Db, w: Awaited<ReturnType<typeof world>>) {
  expect(
    await w.checkIn(w.b.userId, { ...nothing, volunteer: ["captain"] }),
  ).toEqual({ ok: true, value: undefined });
  for (const p of [w.a, w.c, w.d]) await w.checkIn(p.userId);
  await advanceCheckIns(db, day(7));
  expect((await stateOf(db, w.id)).step).toBe("ballot");
}

describe("opening", () => {
  it("opens at season end only, once per team, and tells each roster", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      const early = await openCheckIns(db, {
        seasonId: w.season.id,
        days: 7,
        actorId: w.aces.captain.userId,
        now: NOW,
      });
      expect(early).toEqual({ ok: false, error: "not_season_end" });
      await db
        .update(season)
        .set({ status: "playoffs" })
        .where(eq(season.id, w.season.id));
      expect(
        await openCheckIns(db, {
          seasonId: w.season.id,
          days: 30,
          actorId: w.aces.captain.userId,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "bad_close" });
      const input = {
        seasonId: w.season.id,
        days: 7,
        actorId: w.aces.captain.userId,
        now: NOW,
      };
      expect(await openCheckIns(db, input)).toEqual({ ok: true, value: 2 });
      expect(await openCheckIns(db, input)).toEqual({ ok: true, value: 0 });
      const sent = await messagesTo(db, w.aces.players[0]!.userId);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.payload).toMatchObject({ kind: "opened" });
      expect((await leadershipAudit(db)).map((r) => r.action)).toEqual([
        "leadership.open",
      ]);
    });
  });
});

describe("ballot secrecy", () => {
  it("keeps a suggestion apart from who made it, and asks the teammate later in a batch", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const before = (await allMessages(db)).length;
      // Each check-in in its own subtransaction, as in production. The
      // suggestion comes last, so a write to its row alone would show.
      await db.transaction(async (tx) => {
        await submitCheckIn(tx, {
          checkInId: w.id,
          userId: w.c.userId,
          choice: nothing,
          now: NOW,
        });
      });
      await db.transaction(async (tx) => {
        expect(
          await submitCheckIn(tx, {
            checkInId: w.id,
            userId: w.a.userId,
            choice: { ...nothing, suggest: { userId: w.b.userId, role: "captain" } },
            now: NOW,
          }),
        ).toEqual({ ok: true, value: undefined });
      });
      // Nothing was written that names a choice or marks its moment.
      expect((await allMessages(db)).length).toBe(before);
      expect((await leadershipAudit(db)).map((r) => r.action)).toEqual([
        "leadership.open",
      ]);
      expect(await writers(db, "candidate", w.id)).toBe(1);
      const parts = await db
        .select()
        .from(leadershipParticipation)
        .where(eq(leadershipParticipation.checkInId, w.id));
      expect(parts.map((p) => Object.keys(p).sort())).toEqual([
        ["checkInId", "part", "userId"],
        ["checkInId", "part", "userId"],
      ]);
      // One candidate row per person and role, whoever was suggested.
      const rows = await db
        .select()
        .from(leadershipCandidate)
        .where(eq(leadershipCandidate.checkInId, w.id));
      expect(rows).toHaveLength(12);
      // The teammate sees nothing until the daily job asks them.
      expect((await leadershipFor(db, w.aces.id, w.b.userId))!.me.asks).toEqual(
        [],
      );
      await advanceCheckIns(db, day(1));
      expect((await leadershipFor(db, w.aces.id, w.b.userId))!.me.asks).toEqual([
        { role: "captain", volunteered: false, answer: null },
      ]);
      const asked = await messagesTo(db, w.b.userId);
      expect(asked.map((m) => m.payload)).toContainEqual(
        expect.objectContaining({ kind: "suggested", role: "captain" }),
      );
      // The suggester's own view and export say they checked in, no more.
      const mine = await leadershipFor(db, w.aces.id, w.a.userId);
      expect(mine!.me).toMatchObject({ checkedIn: true, asks: [] });
      expect(await myLeadership(db, w.a.userId)).toEqual({
        tookPart: [{ team: "Aces", season: w.season.name, step: "checked in" }],
        stoodFor: [],
      });
    });
  });

  it("counts a vote without any page, export or log linking it to the voter", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await toBallot(db, w);
      const auditBefore = (await leadershipAudit(db)).length;
      const messagesBefore = (await allMessages(db)).length;
      for (const [voter, choice] of [
        [w.a, w.b],
        [w.b, w.b],
        [w.c, w.cap],
        [w.d, w.b],
      ] as const)
        await db.transaction(async (tx) => {
          const [option] = await tx
            .select({ id: leadershipBallotOption.id })
            .from(leadershipBallotOption)
            .where(
              and(
                eq(leadershipBallotOption.checkInId, w.id),
                eq(leadershipBallotOption.userId, choice.userId),
              ),
            );
          expect(
            await castVote(tx, {
              checkInId: w.id,
              userId: voter.userId,
              optionId: option!.id,
              now: day(8),
            }),
          ).toEqual({ ok: true, value: undefined });
        });
      // Every option row was last written by the same vote.
      expect(await writers(db, "option", w.id)).toBe(1);
      expect((await leadershipAudit(db)).length).toBe(auditBefore);
      expect((await allMessages(db)).length).toBe(messagesBefore);
      // A vote is final.
      expect(await w.vote(w.a.userId, w.cap.userId)).toEqual({
        ok: false,
        error: "already",
      });
      // No view returns a count.
      for (const who of [w.cap, w.a])
        expect(
          JSON.stringify(await leadershipFor(db, w.aces.id, who.userId)),
        ).not.toMatch(/votes/);
      expect(JSON.stringify(await seasonLeadership(db, w.season.id))).not.toMatch(
        /votes/,
      );
      const exported = await myLeadership(db, w.a.userId);
      expect(exported.tookPart.map((t) => t.step)).toEqual([
        "checked in",
        "voted",
      ]);
      expect(JSON.stringify(exported)).not.toMatch(/Bo|Cap|option/);
    });
  });
});

describe("closing the check-in", () => {
  it("changes nothing when not enough of the roster took part", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.checkIn(w.a.userId, { ...nothing, volunteer: ["captain"] });
      await w.checkIn(w.b.userId);
      await w.checkIn(w.c.userId);
      await advanceCheckIns(db, day(6));
      expect((await stateOf(db, w.id)).step).toBe("check_in");
      await advanceCheckIns(db, day(7));
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "no_quorum",
      });
      const told = await messagesTo(db, w.e.userId);
      expect(told.map((m) => m.payload)).toContainEqual(
        expect.objectContaining({ kind: "outcome", outcome: "no_quorum" }),
      );
    });
  });

  it("changes nothing when a suggested teammate declines", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.checkIn(w.a.userId, {
        ...nothing,
        suggest: { userId: w.b.userId, role: "captain" },
      });
      for (const p of [w.c, w.d, w.e]) await w.checkIn(p.userId);
      // Not asked yet: nothing to answer.
      expect(
        await answerSuggestion(db, {
          checkInId: w.id,
          userId: w.b.userId,
          role: "captain",
          accept: false,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_asked" });
      await advanceCheckIns(db, day(1));
      expect(
        await answerSuggestion(db, {
          checkInId: w.id,
          userId: w.b.userId,
          role: "captain",
          accept: false,
          now: day(2),
        }),
      ).toEqual({ ok: true, value: undefined });
      await advanceCheckIns(db, day(7));
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "no_candidates",
      });
    });
  });

  it("waits a fair while for a teammate suggested at the last minute", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const p of [w.c, w.d, w.e]) await w.checkIn(p.userId);
      await w.checkIn(
        w.a.userId,
        { ...nothing, suggest: { userId: w.b.userId, role: "captain" } },
        day(6.9),
      );
      await advanceCheckIns(db, day(7));
      expect((await stateOf(db, w.id)).step).toBe("check_in");
      await answerSuggestion(db, {
        checkInId: w.id,
        userId: w.b.userId,
        role: "captain",
        accept: true,
        now: day(8),
      });
      await advanceCheckIns(db, day(8));
      expect((await stateOf(db, w.id)).step).toBe("ballot");
    });
  });

  it("refuses a second check-in and anyone off the roster", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.checkIn(w.a.userId);
      expect(await w.checkIn(w.a.userId)).toEqual({
        ok: false,
        error: "already",
      });
      expect(await w.checkIn(w.bees.captain.userId)).toEqual({
        ok: false,
        error: "not_on_team",
      });
    });
  });
});

describe("the ballot's result", () => {
  it("treats a tie as no change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await toBallot(db, w);
      await w.vote(w.a.userId, w.b.userId);
      await w.vote(w.b.userId, w.b.userId);
      await w.vote(w.c.userId, w.cap.userId);
      await w.vote(w.cap.userId, w.cap.userId);
      await advanceCheckIns(db, day(13));
      // The captain hears first, whatever the result; the team waits.
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "captain_review",
        outcome: "no_majority",
        electedUserId: null,
      });
      expect(
        (await leadershipFor(db, w.aces.id, w.cap.userId))!.resultForCaptain,
      ).toBe("no_majority");
      expect((await leadershipFor(db, w.aces.id, w.a.userId))!.outcome).toBeNull();
      expect(
        await captainChooses(db, {
          checkInId: w.id,
          userId: w.cap.userId,
          choice: "hand_off_now",
          now: day(14),
        }),
      ).toEqual({ ok: false, error: "closed" });
      await advanceCheckIns(db, day(16));
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "no_majority",
      });
    });
  });

  it("tells the captain first, then the team once they choose", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await toBallot(db, w);
      for (const p of [w.a, w.b, w.c]) await w.vote(p.userId, w.b.userId);
      await w.vote(w.cap.userId, w.cap.userId);
      await advanceCheckIns(db, day(13));
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "captain_review",
        electedUserId: w.b.userId,
      });
      expect(
        (await leadershipFor(db, w.aces.id, w.cap.userId))!.electedForCaptain,
      ).toBe("Bo E.");
      // The team hears nothing yet.
      const mate = await leadershipFor(db, w.aces.id, w.a.userId);
      expect(mate).toMatchObject({ electedForCaptain: null, elected: null });
      expect(
        (await messagesTo(db, w.a.userId)).filter(
          (m) => (m.payload as { kind: string }).kind === "outcome",
        ),
      ).toEqual([]);
      expect(
        (await messagesTo(db, w.cap.userId)).map((m) => m.template),
      ).toContain("leadership_result");
      expect(
        await captainChooses(db, {
          checkInId: w.id,
          userId: w.a.userId,
          choice: "hand_off_now",
          now: day(14),
        }),
      ).toEqual({ ok: false, error: "not_captain" });
      expect(
        await captainChooses(db, {
          checkInId: w.id,
          userId: w.cap.userId,
          choice: "captain_elect",
          now: day(14),
        }),
      ).toEqual({ ok: true, value: undefined });
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "new_captain",
        captainChoice: "captain_elect",
      });
      // The captain-elect co-captains now; the captain stays captain.
      const roles = await db
        .select({ userId: registration.userId, role: rosterMembership.role })
        .from(rosterMembership)
        .innerJoin(
          registration,
          eq(rosterMembership.registrationId, registration.id),
        )
        .where(eq(rosterMembership.teamSeasonId, w.aces.id));
      expect(roles).toContainEqual({ userId: w.b.userId, role: "co_captain" });
      expect(roles).toContainEqual({ userId: w.cap.userId, role: "captain" });
      expect((await messagesTo(db, w.a.userId)).map((m) => m.payload)).toContainEqual(
        expect.objectContaining({
          kind: "outcome",
          outcome: "new_captain",
          elected: "Bo E.",
          when: "next_season",
        }),
      );
      expect((await leadershipFor(db, w.aces.id, w.a.userId))!.elected).toBe(
        "Bo E.",
      );
    });
  });

  it("offers the captaincy to the teammate when a captain who'd hand over makes no choice", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await w.checkIn(w.cap.userId, { ...nothing, steppingDown: true });
      await toBallot(db, w);
      const options = await db
        .select({ userId: leadershipBallotOption.userId })
        .from(leadershipBallotOption)
        .where(eq(leadershipBallotOption.checkInId, w.id));
      // The captain said they'd hand over, so they aren't on the ballot.
      expect(options.map((o) => o.userId)).toEqual([w.b.userId]);
      for (const p of [w.a, w.b, w.c, w.d]) await w.vote(p.userId, w.b.userId);
      await advanceCheckIns(db, day(13));
      expect((await stateOf(db, w.id)).step).toBe("captain_review");
      await advanceCheckIns(db, day(15.9));
      expect((await stateOf(db, w.id)).step).toBe("captain_review");
      await advanceCheckIns(db, day(16));
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "new_captain",
        captainChoice: "hand_off_now",
      });
      const [offer] = await db
        .select({ toUserId: captainHandoff.toUserId, status: captainHandoff.status })
        .from(captainHandoff)
        .where(eq(captainHandoff.teamSeasonId, w.aces.id));
      expect(offer).toEqual({ toUserId: w.b.userId, status: "pending" });
    });
  });
});

describe("roster changes", () => {
  it("lets a newcomer take part, drops a leaver, and keeps quorum to the roster now", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const newcomer = await w.person("ace-new");
      await w.join(w.aces.id, newcomer);
      expect(await w.checkIn(newcomer.userId)).toEqual({
        ok: true,
        value: undefined,
      });
      // `b` volunteers, then leaves the team.
      await w.checkIn(w.b.userId, { ...nothing, volunteer: ["captain"] });
      await w.checkIn(w.a.userId);
      await w.checkIn(w.c.userId);
      await db
        .update(rosterMembership)
        .set({ status: "removed" })
        .where(eq(rosterMembership.registrationId, w.b.registrationId));
      expect(await w.checkIn(w.d.userId, { ...nothing, suggest: { userId: w.b.userId, role: "captain" } })).toEqual({
        ok: false,
        error: "suggest_not_on_team",
      });
      // Six on the roster now; newcomer, a and c count: three of four needed.
      const view = await leadershipFor(db, w.aces.id, w.a.userId);
      expect(view!.progress).toEqual({ tookPart: 3, needed: 4, roster: 6 });
      await w.checkIn(w.d.userId);
      await advanceCheckIns(db, day(7));
      // The leaver isn't on a ballot, so there's nothing to vote on.
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "no_candidates",
      });
    });
  });

  it("refuses a vote from someone who left, and changes nothing if the winner left", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await toBallot(db, w);
      for (const p of [w.a, w.b, w.c, w.d]) await w.vote(p.userId, w.b.userId);
      await db
        .update(rosterMembership)
        .set({ status: "removed" })
        .where(eq(rosterMembership.registrationId, w.e.registrationId));
      expect(await w.vote(w.e.userId, w.cap.userId)).toEqual({
        ok: false,
        error: "not_on_team",
      });
      await db
        .update(rosterMembership)
        .set({ status: "removed" })
        .where(eq(rosterMembership.registrationId, w.b.registrationId));
      await advanceCheckIns(db, day(13));
      await advanceCheckIns(db, day(16));
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "winner_left",
      });
    });
  });
});

describe("an admin stepping in", () => {
  it("pauses everything, moves the deadline on when resumed, and can close with no change", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const admin = w.cap.userId;
      expect(
        await pauseCheckIn(db, { checkInId: w.id, actorId: admin, now: day(2) }),
      ).toEqual({ ok: true, value: undefined });
      expect(await w.checkIn(w.a.userId, nothing, day(3))).toEqual({
        ok: false,
        error: "paused",
      });
      await advanceCheckIns(db, day(10));
      expect((await stateOf(db, w.id)).step).toBe("check_in");
      await resumeCheckIn(db, { checkInId: w.id, actorId: admin, now: day(4) });
      const resumed = await stateOf(db, w.id);
      expect(resumed.pausedAt).toBeNull();
      expect(resumed.checkInClosesAt).toEqual(day(9));
      expect(await w.checkIn(w.a.userId, nothing, day(5))).toEqual({
        ok: true,
        value: undefined,
      });
      await closeByLeague(db, { checkInId: w.id, actorId: admin, now: day(5) });
      expect(await stateOf(db, w.id)).toMatchObject({
        step: "closed",
        outcome: "closed_by_league",
      });
      // The Bees' check-in closed on its own; only the Aces' was paused.
      expect(
        (await leadershipAudit(db))
          .filter((r) => r.entityId === w.aces.id)
          .map((r) => r.action)
          .sort(),
      ).toEqual(["leadership.close", "leadership.pause", "leadership.resume"]);
      const rows = await seasonLeadership(db, w.season.id);
      expect(rows.find((r) => r.team === "Aces")).toMatchObject({
        step: "closed",
        outcome: "closed_by_league",
        tookPart: 1,
      });
    });
  });
});
