import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { GameId, UserId } from "@/domain/ids";
import { user } from "../schema/auth";
import { auditLog } from "../schema/audit";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { refereeProfile } from "../schema/referees";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  askForUnstaffedGames,
  dropRefereeGame,
  gamesNeedingRef,
  gameToTake,
  takeRefereeGame,
} from "./referee-cover";
import { required } from "./rows";
import type { Db } from "./schedule";

afterAll(closePool);

const HOUR = 3_600_000;

/**
 * Three hours from now: Aces v Bees on field 1 and Cats v Dogs on field 2.
 * Two days out: Bees v Dogs on field 1. Pat plays for the Aces; Pat, Quinn
 * and Remy are in the pool; Sam isn't, but refs Bees v Dogs; Tess is
 * neither.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(user)
    .values(
      ["pat", "quinn", "remy", "sam", "tess"].map((n) => ({
        name: n,
        email: `cover-${n}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id });
  const [pat, quinn, remy, sam, tess] = people.map((p) => p.id) as [
    UserId,
    UserId,
    UserId,
    UserId,
    UserId,
  ];
  await db
    .insert(profile)
    .values(people.map((p) => ({ userId: p.id, firstName: "x" })));
  const lg = required(
    (
      await db
        .insert(league)
        .values({ name: "L", slug: `cover-${tag}` })
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
          status: "in_progress",
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
  const fields = await db
    .insert(field)
    .values([
      { venueId: vn.id, name: "Field 1" },
      { venueId: vn.id, name: "Field 2" },
    ])
    .returning({ id: field.id });
  const soon = Math.ceil((Date.now() + 3 * HOUR) / HOUR) * HOUR;
  const plan = [
    { field: 0, at: soon },
    { field: 1, at: soon },
    { field: 0, at: soon + 48 * HOUR },
  ];
  const slots = await db
    .insert(slot)
    .values(
      plan.map((p, i) => ({
        seasonId: sn.id,
        fieldId: required(fields[p.field], "field").id,
        startsAt: new Date(p.at),
        endsAt: new Date(p.at + HOUR),
        timeIndex: i,
      })),
    )
    .returning({ id: slot.id });
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
  const e = (i: number) => required(entries[i], "entry").id;
  const games = await db
    .insert(game)
    .values(
      [
        [0, 1],
        [2, 3],
        [1, 3],
      ].map(([a, b], i) => ({
        seasonId: sn.id,
        teamAId: e(a ?? 0),
        teamBId: e(b ?? 0),
        slotId: required(slots[i], "slot").id,
      })),
    )
    .returning({ id: game.id });
  const [acesBees, catsDogs, beesDogs] = games.map((g) => g.id) as [
    GameId,
    GameId,
    GameId,
  ];
  const reg = required(
    (
      await db
        .insert(registration)
        .values({ seasonId: sn.id, userId: pat, kind: "team_member" })
        .returning({ id: registration.id })
    )[0],
    "registration",
  );
  await db.insert(rosterMembership).values({
    teamSeasonId: e(0),
    registrationId: reg.id,
    status: "active",
  });
  await db
    .insert(refereeProfile)
    .values([pat, quinn, remy].map((userId) => ({ leagueId: lg.id, userId })));
  await db.insert(refereeAssignment).values([
    { gameId: acesBees, userId: quinn },
    { gameId: beesDogs, userId: sam },
  ]);
  return {
    leagueId: lg.id,
    seasonId: sn.id,
    pat,
    quinn,
    remy,
    sam,
    tess,
    acesBees,
    catsDogs,
    beesDogs,
    soon: new Date(soon),
  };
}

const asksFor = (db: Db, gameId: GameId) =>
  db
    .select({ userId: message.userId, dedupeKey: message.dedupeKey })
    .from(message)
    .where(
      and(eq(message.template, "referee_needed"), eq(message.channel, "email")),
    )
    .then((rows) => rows.filter((r) => r.dedupeKey.includes(gameId)));

describe("covering a game", () => {
  it("lets a ref drop a game with a reason and asks the free refs at once", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const now = new Date();
      expect(
        await dropRefereeGame(db, {
          gameId: w.acesBees,
          userId: w.quinn,
          reason: "Sick, sorry",
          now,
        }),
      ).toEqual({ ok: true, value: { asked: 2 } });
      // Pat plays in it and Quinn just dropped it; Remy (pool) and Sam
      // (reffed this season) are free.
      const asked = await asksFor(db, w.acesBees);
      expect(asked.map((a) => a.userId).sort()).toEqual([w.remy, w.sam].sort());
      const [audit] = await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "referee.drop"),
            eq(auditLog.entityId, w.acesBees),
          ),
        );
      expect(audit?.after).toMatchObject({ reason: "Sick, sorry" });
      expect(
        await dropRefereeGame(db, {
          gameId: w.acesBees,
          userId: w.quinn,
          reason: "Again",
          now,
        }),
      ).toEqual({ ok: false, error: "not_yours" });
      // A game two days out asks nobody yet; one that started can't be
      // dropped.
      expect(
        await dropRefereeGame(db, {
          gameId: w.beesDogs,
          userId: w.sam,
          reason: "Away",
          now,
        }),
      ).toEqual({ ok: true, value: { asked: 0 } });
      await db.insert(refereeAssignment).values({
        gameId: w.catsDogs,
        userId: w.remy,
      });
      expect(
        await dropRefereeGame(db, {
          gameId: w.catsDogs,
          userId: w.remy,
          reason: "Late",
          now: new Date(w.soon.getTime() + 60_000),
        }),
      ).toEqual({ ok: false, error: "started" });
    });
  });

  it("gives the game to the first ref who takes it, and only to one who can", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const now = new Date();
      await dropRefereeGame(db, {
        gameId: w.acesBees,
        userId: w.quinn,
        reason: "Sick",
        now,
      });
      const take = (userId: UserId, gameId: GameId = w.acesBees) =>
        takeRefereeGame(db, { gameId, userId, now });
      expect(await take(w.tess)).toEqual({ ok: false, error: "not_a_ref" });
      expect(await take(w.pat)).toEqual({ ok: false, error: "plays" });
      // Pat isn't in Cats v Dogs, but plays at that time.
      expect(await take(w.pat, w.catsDogs)).toEqual({
        ok: false,
        error: "plays",
      });
      expect(await take(w.remy)).toEqual({ ok: true, value: undefined });
      expect(await take(w.sam)).toEqual({ ok: false, error: "taken" });
      // Remy now refs at that time, so can't take the other game then.
      expect(await take(w.remy, w.catsDogs)).toEqual({
        ok: false,
        error: "busy",
      });
      expect(
        (await gameToTake(db, { gameId: w.acesBees, userId: w.remy, now }))
          ?.state,
      ).toBe("yours");
      expect(
        (await gameToTake(db, { gameId: w.acesBees, userId: w.sam, now }))
          ?.state,
      ).toBe("taken");
      expect(
        (
          await gameToTake(db, {
            gameId: w.acesBees,
            userId: w.sam,
            now: new Date(w.soon.getTime() + 60_000),
          })
        )?.state,
      ).toBe("closed");
      expect(
        await takeRefereeGame(db, {
          gameId: w.catsDogs,
          userId: w.sam,
          now: new Date(w.soon.getTime() + 60_000),
        }),
      ).toEqual({ ok: false, error: "started" });
    });
  });

  it("asks once a day about games within a day that never had a ref", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const now = new Date();
      const needing = await gamesNeedingRef(db, { leagueId: w.leagueId, now });
      expect(needing.map((g) => g.gameId)).toEqual([w.catsDogs]);
      // Quinn refs at that time and Pat plays then; Remy and Sam are free.
      expect(
        await askForUnstaffedGames(db, { leagueId: w.leagueId, now }),
      ).toBe(2);
      expect(
        await askForUnstaffedGames(db, { leagueId: w.leagueId, now }),
      ).toBe(0);
      expect(
        (await asksFor(db, w.catsDogs)).map((a) => a.userId).sort(),
      ).toEqual([w.remy, w.sam].sort());
    });
  });

  it("asks nobody about a draft season's games, which aren't out yet", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const now = new Date();
      await db
        .update(season)
        .set({ status: "draft" })
        .where(eq(season.id, w.seasonId));
      expect(await gamesNeedingRef(db, { leagueId: w.leagueId, now })).toEqual(
        [],
      );
      expect(
        await dropRefereeGame(db, {
          gameId: w.acesBees,
          userId: w.quinn,
          reason: "Sick",
          now,
        }),
      ).toEqual({ ok: true, value: { asked: 0 } });
      expect(
        await takeRefereeGame(db, { gameId: w.acesBees, userId: w.remy, now }),
      ).toEqual({ ok: false, error: "gone" });
    });
  });
});
