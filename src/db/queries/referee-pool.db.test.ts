import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { GameId, UserId } from "@/domain/ids";
import { proposeReferees } from "@/domain/referees/assign";
import { paySheet } from "@/domain/referees/pay";
import { user } from "../schema/auth";
import { expense } from "../schema/books";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  acceptProposals,
  addToRefereePool,
  assignerInputs,
  availabilityOf,
  myRefereeGames,
  payInputs,
  recordPayout,
  refereePool,
  removeFromRefereePool,
  setAvailability,
} from "./referee-pool";
import { assignReferee } from "./referees";
import { required } from "./rows";
import { loadSubject } from "./subject";
import type { Db } from "./schedule";

afterAll(closePool);

const HOUR = 3_600_000;

/**
 * A season a week out, with Pat playing for the Aces: Aces v Bees on
 * field 1 and Cats v Dogs on field 2 at the same time, then Bees v Dogs on
 * field 2 an hour later.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["admin", "pat", "quinn", "remy", "sam"].map((n) => ({
        name: n,
        email: `pool-${n}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id, email: user.email });
  const [admin, pat, quinn, remy, sam] = people.map((p) => p.id);
  await db
    .insert(profile)
    .values(people.map((p) => ({ userId: p.id, firstName: "x" })));
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "L", slug: `pool-${tag}` })
        .returning({ id: league.id })
    )[0],
    "league",
  );
  const sn = required(
    (
      await db
        .insert(season)
        .values({
          leagueId: lg.id,
          name: "Fall",
          slug: "fall",
          startsOn: "2026-09-01",
          endsOn: "2027-11-01",
          feeModel: "per_player",
          playerFeeCents: 8500,
          rosterMin: 12,
          rosterMax: 20,
        })
        .returning({ id: season.id })
    )[0],
    "season",
  );
  const vn = required(
    (
      await db
        .insert(venue)
        .values({ leagueId: lg.id, name: "Park", slug: "park" })
        .returning({ id: venue.id })
    )[0],
    "venue",
  );
  const [f1, f2] = await db
    .insert(field)
    .values([
      { venueId: vn.id, name: "Field 1" },
      { venueId: vn.id, name: "Field 2" },
    ])
    .returning({ id: field.id });
  const t0 = Math.ceil((Date.now() + 7 * 24 * HOUR) / HOUR) * HOUR;
  const slots = await db
    .insert(slot)
    .values(
      [
        [f1, 0],
        [f2, 0],
        [f2, 1],
      ].map(([f, i], n) => ({
        seasonId: sn.id,
        fieldId: required(typeof f === "object" ? f : undefined, "field").id,
        startsAt: new Date(t0 + Number(i) * HOUR),
        endsAt: new Date(t0 + (Number(i) + 1) * HOUR),
        timeIndex: n,
      })),
    )
    .returning({ id: slot.id, startsAt: slot.startsAt });
  const teams = await db
    .insert(team)
    .values(
      ["Aces", "Bees", "Cats", "Dogs"].map((n) => ({
        leagueId: lg.id,
        name: n,
        slug: `${n.toLowerCase()}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  const entries = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: sn.id })))
    .returning({ id: teamSeason.id });
  const [aces, bees, cats, dogs] = entries.map((e) => e.id);
  const games = await db
    .insert(game)
    .values(
      [
        [aces, bees, 0],
        [cats, dogs, 1],
        [bees, dogs, 2],
      ].map(([a, b, s]) => ({
        seasonId: sn.id,
        teamAId: required(typeof a === "string" ? a : undefined, "a"),
        teamBId: required(typeof b === "string" ? b : undefined, "b"),
        slotId: required(slots[Number(s)], "slot").id,
      })),
    )
    .returning({ id: game.id });
  const reg = required(
    (
      await db
        .insert(registration)
        .values({
          seasonId: sn.id,
          userId: required(pat, "pat"),
          kind: "team_member",
        })
        .returning({ id: registration.id })
    )[0],
    "registration",
  );
  await db.insert(rosterMembership).values({
    teamSeasonId: required(aces, "aces"),
    registrationId: reg.id,
    status: "active",
  });
  return {
    leagueId: lg.id,
    seasonId: sn.id,
    admin: required(admin, "admin"),
    pat: required(pat, "pat"),
    quinn: required(quinn, "quinn"),
    remy: required(remy, "remy"),
    sam: required(sam, "sam"),
    emailOf: (id: UserId) =>
      required(
        people.find((p) => p.id === id),
        "person",
      ).email,
    dogs: required(dogs, "dogs"),
    games: [0, 1, 2].map((i) => required(games[i], "game").id) as [
      GameId,
      GameId,
      GameId,
    ],
    times: [0, 1, 2].map((i) => required(slots[i], "slot").startsAt) as [
      Date,
      Date,
      Date,
    ],
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function pool(db: Db, w: World, ids: UserId[]) {
  for (const id of ids)
    expect(
      await addToRefereePool(db, {
        leagueId: w.leagueId,
        email: w.emailOf(id),
        actorId: w.admin,
      }),
    ).toEqual({ ok: true, value: id });
}

const assignerFor = (db: Db, w: World) =>
  assignerInputs(db, {
    seasonId: w.seasonId,
    leagueId: w.leagueId,
    timeZone: "UTC",
    day: null,
    now: new Date(),
  });

describe("the ref pool", () => {
  it("adds and removes refs, and makes them refs before any game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await addToRefereePool(db, {
          leagueId: w.leagueId,
          email: "nobody@example.test",
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "no_account" });
      expect((await loadSubject(db, w.quinn, w.leagueId)).isReferee).toBe(
        false,
      );
      await pool(db, w, [w.quinn]);
      expect((await loadSubject(db, w.quinn, w.leagueId)).isReferee).toBe(true);
      expect(
        await addToRefereePool(db, {
          leagueId: w.leagueId,
          email: w.emailOf(w.quinn).toUpperCase(),
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "already_in_pool" });
      await removeFromRefereePool(db, {
        leagueId: w.leagueId,
        userId: w.quinn,
        actorId: w.admin,
      });
      expect(await refereePool(db, w.leagueId)).toEqual([]);
      expect((await loadSubject(db, w.quinn, w.leagueId)).isReferee).toBe(
        false,
      );
    });
  });

  it("keeps times not on the form when a ref saves when they can work", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [first, , later] = w.times;
      await setAvailability(db, {
        seasonId: w.seasonId,
        userId: w.quinn,
        shown: [first, later],
        ticked: [first, later],
      });
      await setAvailability(db, {
        seasonId: w.seasonId,
        userId: w.quinn,
        shown: [later],
        ticked: [],
      });
      expect(await availabilityOf(db, w.seasonId, w.quinn)).toEqual([first]);
    });
  });
});

describe("accepting proposals", () => {
  it("proposes no ref for their own team, and assigns what the admin accepts", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pool(db, w, [w.pat, w.quinn, w.remy]);
      for (const id of [w.pat, w.quinn, w.remy])
        await setAvailability(db, {
          seasonId: w.seasonId,
          userId: id,
          shown: w.times,
          ticked: w.times,
        });
      const inputs = await assignerFor(db, w);
      expect(inputs.games).toHaveLength(3);
      expect(inputs.refs.find((r) => r.id === w.pat)?.teamSeasonIds.size).toBe(
        1,
      );
      const proposal = proposeReferees(inputs);
      const [acesBees, catsDogs, beesDogs] = w.games;
      // Pat plays at the first time, and would have to cross to field 2
      // straight after, so Pat is proposed for nothing.
      expect([...proposal.assignments.values()]).not.toContain(w.pat);
      const first = proposal.assignments.get(acesBees);
      const second = proposal.assignments.get(catsDogs);
      expect(new Set([first, second])).toEqual(new Set([w.quinn, w.remy]));
      // Whoever had field 2 stays on it for Bees v Dogs.
      expect(proposal.assignments.get(beesDogs)).toBe(second);
      expect(proposal.unfilled).toEqual([]);

      const pairs = [...proposal.assignments].map(([gameId, userId]) => ({
        gameId: required(
          w.games.find((g) => g === gameId),
          "game",
        ),
        userId: required(
          [w.quinn, w.remy].find((u) => u === userId),
          "ref",
        ),
      }));
      expect(
        await acceptProposals(db, {
          seasonId: w.seasonId,
          leagueId: w.leagueId,
          pairs,
          actorId: w.admin,
        }),
      ).toEqual({ assigned: 3, skipped: 0, why: null });
      expect((await assignerFor(db, w)).games).toEqual([]);
      // Accepting the same proposals again changes nothing.
      expect(
        await acceptProposals(db, {
          seasonId: w.seasonId,
          leagueId: w.leagueId,
          pairs,
          actorId: w.admin,
        }),
      ).toEqual({ assigned: 0, skipped: 3, why: "closed" });
    });
  });

  it("skips a hand pick that breaks a hard rule, and allows one that only waives availability", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pool(db, w, [w.pat, w.quinn]);
      const [acesBees, catsDogs, beesDogs] = w.games;
      const accept = (pairs: { gameId: GameId; userId: UserId }[]) =>
        acceptProposals(db, {
          seasonId: w.seasonId,
          leagueId: w.leagueId,
          pairs,
          actorId: w.admin,
        });
      // Their own team, someone outside the pool, and two games at once.
      expect(await accept([{ gameId: acesBees, userId: w.pat }])).toEqual({
        assigned: 0,
        skipped: 1,
        why: "clash",
      });
      expect(await accept([{ gameId: acesBees, userId: w.sam }])).toEqual({
        assigned: 0,
        skipped: 1,
        why: "not_in_pool",
      });
      expect(
        await accept([
          { gameId: acesBees, userId: w.quinn },
          { gameId: catsDogs, userId: w.quinn },
        ]),
      ).toEqual({ assigned: 1, skipped: 1, why: "clash" });
      // Pat plays while Cats v Dogs is on.
      expect(await accept([{ gameId: catsDogs, userId: w.pat }])).toEqual({
        assigned: 0,
        skipped: 1,
        why: "clash",
      });
      // Pat said nothing about times and would change fields after their
      // own game, but those are preferences an admin may overrule.
      expect(await accept([{ gameId: beesDogs, userId: w.pat }])).toEqual({
        assigned: 1,
        skipped: 0,
        why: null,
      });
      const live = await db
        .select({ gameId: refereeAssignment.gameId })
        .from(refereeAssignment)
        .where(eq(refereeAssignment.status, "accepted"));
      expect(live.map((l) => l.gameId).sort()).toEqual(
        [acesBees, beesDogs].sort(),
      );
    });
  });

  it("refuses to make a ref of a player on either team by email too", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await assignReferee(db, {
          seasonId: w.seasonId,
          gameId: w.games[0],
          email: w.emailOf(w.pat),
          actorId: w.admin,
        }),
      ).toEqual({ ok: false, error: "own_team" });
    });
  });
});

describe("the pay sheet", () => {
  it("pays games checked in for, forfeits included, and records payouts in the books", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      await pool(db, w, [w.quinn, w.remy]);
      const [acesBees, catsDogs, beesDogs] = w.games;
      await db.insert(refereeAssignment).values([
        { gameId: acesBees, userId: w.quinn, checkedInAt: new Date() },
        { gameId: beesDogs, userId: w.quinn },
        { gameId: catsDogs, userId: w.remy, checkedInAt: new Date() },
      ]);
      // Cats v Dogs ends in a forfeit at the field; Remy still turned up.
      await db
        .update(game)
        .set({ status: "forfeit", forfeitBy: w.dogs })
        .where(eq(game.id, catsDogs));
      const inputs = await payInputs(db, {
        seasonId: w.seasonId,
        leagueId: w.leagueId,
      });
      const rows = paySheet(inputs, 2500);
      expect(
        rows.map((r) => [r.userId, r.gamesWorked, r.owedCents]).sort(),
      ).toEqual(
        [
          [w.quinn, 1, 2500],
          [w.remy, 1, 2500],
        ].sort(),
      );
      expect(
        (
          await myRefereeGames(db, { seasonId: w.seasonId, userId: w.quinn })
        ).map((g) => g.worked),
      ).toEqual([true, false]);

      const pay = (paidBeforeCents: number, userId: UserId = w.quinn) =>
        recordPayout(db, {
          leagueId: w.leagueId,
          seasonId: w.seasonId,
          userId,
          amountCents: 2500,
          method: "venmo",
          paidOn: "2026-10-01",
          paidBeforeCents,
          actorId: w.admin,
        });
      expect(await pay(0)).toEqual({ ok: true, value: undefined });
      // The same tap again: the sheet it came from is out of date.
      expect(await pay(0)).toEqual({ ok: false, error: "stale" });
      expect(await pay(0, w.sam)).toEqual({ ok: false, error: "unknown_ref" });
      const books = await db
        .select({ category: expense.category, note: expense.note })
        .from(expense)
        .where(eq(expense.seasonId, w.seasonId));
      expect(books).toEqual([{ category: "refs", note: "Ref pay (Venmo)" }]);
      const mine = await payInputs(db, {
        seasonId: w.seasonId,
        leagueId: w.leagueId,
        userId: w.quinn,
      });
      expect(mine).toEqual([
        { userId: w.quinn, name: "quinn", gamesWorked: 1, paidCents: 2500 },
      ]);
    });
  });
});
