import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId, LeagueId, SubRequestId } from "@/domain/ids";
import { ok } from "@/domain/result";
import * as schema from "../schema";
import { user } from "../schema/auth";
import { field, game, refereeAssignment, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { message, notificationPreference } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { subClaim, subRequest } from "../schema/subs";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import {
  cancelSubRequest,
  claimSubSpot,
  decideSubClaim,
  MAX_OPEN_PER_TEAM,
  pickupsFor,
  postSubRequest,
  subRequestsFor,
  teamSubRequests,
  withdrawSubClaim,
} from "./subs";

afterAll(closePool);

const NOW = new Date("2026-09-14T12:00:00Z");
/** The Aces vs Bees game: 7 to 8 PM UTC on NOW's day. */
const GAME_ENDS = new Date("2026-09-14T20:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

/**
 * The messaging world plus everyone the sub finder cares about: a third
 * team that is free at game time, a fourth that plays at the same time on
 * another field, a ref busy then, and lineup genders.
 */
async function subWorld(db: Db) {
  const w = await messagingWorld(db);
  const named = async (
    p: Player,
    firstName: string,
    lineupGender: "woman" | "man",
  ) =>
    db.insert(profile).values({
      userId: p.userId,
      firstName,
      lastName: "Sample",
      lineupGender,
    });
  const cats = await w.entry("Cats");
  const dogs = await w.entry("Dogs");
  const catWoman = await w.person("cat-w");
  const catMan = await w.person("cat-m");
  const dogWoman = await w.person("dog-w");
  const busyRef = await w.person("ref-w");
  const optedOut = await w.person("quiet-w");
  await w.join(cats, catWoman);
  await w.join(cats, catMan);
  await w.join(dogs, dogWoman);
  await w.join(cats, optedOut);
  await named(w.freeAgent, "Fran", "woman");
  await named(catWoman, "Cara", "woman");
  await named(catMan, "Cal", "man");
  await named(dogWoman, "Dee", "woman");
  await named(busyRef, "Rae", "woman");
  await named(optedOut, "Quinn", "woman");
  await db.insert(notificationPreference).values({
    userId: optedOut.userId,
    topic: "sub_request",
    channel: "email",
    enabled: false,
  });

  const { gameId } = await w.gameEnding(GAME_ENDS);
  // Dogs play another team at the same time on Field 3, refereed by busyRef.
  const other = await w.entry("Owls");
  await w.gameBetween(dogs, other, GAME_ENDS, {
    onField: await w.addField("Field 3"),
    refereeId: busyRef.userId,
  });
  // Cats play earlier that day, so they are free at game time.
  await w.gameBetween(cats, other, hours(6));
  return {
    ...w,
    gameId,
    cats,
    dogs,
    catWoman,
    catMan,
    dogWoman,
    busyRef,
    optedOut,
  };
}

type World = Awaited<ReturnType<typeof subWorld>>;

const post = (
  db: Db,
  w: World,
  spots: { needed: number; womenNeeded?: number; menNeeded?: number },
  gameId: GameId = w.gameId,
) =>
  postSubRequest(db, {
    gameId,
    teamSeasonId: w.aces.id,
    requestedBy: w.aces.captain.userId,
    spots: { womenNeeded: 0, menNeeded: 0, ...spots },
    note: "Bring a red shirt",
    now: NOW,
  });

async function posted(db: Db, w: World, spots: Parameters<typeof post>[2]) {
  const result = await post(db, w, spots);
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

const messagesLike = (db: Db, prefix: string) =>
  db
    .select({
      userId: message.userId,
      template: message.template,
      topic: message.topic,
      payload: message.payload,
    })
    .from(message)
    .where(like(message.dedupeKey, `${prefix}%`));

const claim = (db: Db, requestId: SubRequestId, p: Player, now = NOW) =>
  claimSubSpot(db, { requestId, userId: p.userId, now });

describe("posting a sub request", () => {
  it("tells free agents and free players from other teams, and nobody else", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const result = await post(db, w, { needed: 2 });
      if (!result.ok) throw new Error(result.error);
      const told = await messagesLike(db, `sub_request/${result.value.id}/`);
      const ids = told.map((m) => m.userId).sort();
      // Not: Aces or Bees (in the game), the Dogs player and the ref (busy
      // then), the pending-waiver Bees player, the cancelled registration,
      // or the player who turned sub alerts off.
      expect(ids).toEqual(
        [w.freeAgent.userId, w.catWoman.userId, w.catMan.userId].sort(),
      );
      expect(result.value.notified).toBe(3);
      expect(told[0]).toMatchObject({
        topic: "sub_request",
        template: "sub_request",
      });
      const toFreeAgent = told.find((m) => m.userId === w.freeAgent.userId);
      expect(toFreeAgent?.payload).toMatchObject({
        team: "Aces",
        teams: "Aces vs Bees",
        spots: "2 subs",
        note: "Bring a red shirt",
        freeAgent: true,
      });
    }));

  it("tells only women when every spot is for a woman", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 1, womenNeeded: 1 });
      const told = await messagesLike(db, `sub_request/${id}/`);
      expect(told.map((m) => m.userId).sort()).toEqual(
        [w.freeAgent.userId, w.catWoman.userId].sort(),
      );
      expect(told[0]?.payload).toMatchObject({
        spots: "1 sub, at least 1 woman",
      });
    }));

  it("is blocked for playoff games", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      await db
        .update(game)
        .set({ kind: "playoff", roundNo: null })
        .where(eq(game.id, w.gameId));
      expect(await post(db, w, { needed: 1 })).toEqual({
        ok: false,
        error: "playoff",
      });
      expect(
        await db
          .select()
          .from(subRequest)
          .where(eq(subRequest.gameId, w.gameId)),
      ).toEqual([]);
    }));

  it("is only for the poster's own game, before it starts", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      expect(
        await postSubRequest(db, {
          gameId: w.gameId,
          teamSeasonId: w.cats,
          requestedBy: w.catWoman.userId,
          spots: { needed: 1, womenNeeded: 0, menNeeded: 0 },
          note: null,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_your_game" });
      expect(
        await postSubRequest(db, {
          gameId: w.gameId,
          teamSeasonId: w.aces.id,
          requestedBy: w.aces.captain.userId,
          spots: { needed: 1, womenNeeded: 0, menNeeded: 0 },
          note: null,
          now: GAME_ENDS,
        }),
      ).toEqual({ ok: false, error: "started" });
      expect(await post(db, w, { needed: 1, womenNeeded: 2 })).toEqual({
        ok: false,
        error: "invalid_spots",
      });
    }));

  it("allows one live request per game and a few open per team", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      await posted(db, w, { needed: 1 });
      expect(await post(db, w, { needed: 2 })).toEqual({
        ok: false,
        error: "already_posted",
      });
      for (let day = 1; day < MAX_OPEN_PER_TEAM; day++) {
        const { gameId } = await w.gameEnding(hours(8 + 24 * day));
        expect((await post(db, w, { needed: 1 }, gameId)).ok).toBe(true);
      }
      const { gameId } = await w.gameEnding(hours(8 + 24 * MAX_OPEN_PER_TEAM));
      expect(await post(db, w, { needed: 1 }, gameId)).toEqual({
        ok: false,
        error: "too_many_open",
      });
    }));
});

describe("claiming a spot", () => {
  it("holds a spot and tells the captain", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 2 });
      const result = await claim(db, id, w.catWoman);
      if (!result.ok) throw new Error(result.error);
      const [held] = await db
        .select()
        .from(subClaim)
        .where(eq(subClaim.id, result.value));
      expect(held).toMatchObject({ status: "pending", lineupGender: "woman" });
      const told = await messagesLike(db, `sub_claimed/${result.value}/`);
      expect(told.map((m) => m.userId)).toEqual([w.aces.captain.userId]);
      expect(told[0]?.payload).toMatchObject({
        kind: "claimed",
        player: "Cara S.",
      });
      expect(await claim(db, id, w.catWoman)).toEqual({
        ok: false,
        error: "already_claimed",
      });
    }));

  it("turns away players who may not sub in this game", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 3 });
      expect(await claim(db, id, w.aces.players[0]!)).toEqual({
        ok: false,
        error: "plays_in_game",
      });
      expect(await claim(db, id, w.dogWoman)).toEqual({
        ok: false,
        error: "busy",
      });
      expect(await claim(db, id, w.busyRef)).toEqual({
        ok: false,
        error: "busy",
      });
      expect(await claim(db, id, w.cancelled)).toEqual({
        ok: false,
        error: "not_registered",
      });
      const unsigned = await w.person("late", "pending_waiver");
      expect(await claim(db, id, unsigned)).toEqual({
        ok: false,
        error: "waiver_unsigned",
      });
    }));

  it("keeps a spot reserved for a woman, and refuses once every spot is held", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 2, womenNeeded: 1 });
      expect((await claim(db, id, w.catMan)).ok).toBe(true);
      const man = await w.person("man-2", "active");
      await db
        .insert(profile)
        .values({ userId: man.userId, lineupGender: "man" });
      expect(await claim(db, id, man)).toEqual({ ok: false, error: "full" });
      expect((await claim(db, id, w.freeAgent)).ok).toBe(true);
      expect(await claim(db, id, w.catWoman)).toEqual({
        ok: false,
        error: "full",
      });
    }));

  it("closes at game time", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 1 });
      expect(await claim(db, id, w.catWoman, hours(7))).toEqual({
        ok: false,
        error: "closed",
      });
    }));
});

describe("approving and declining", () => {
  it("approves subs, fills the request and shows the pickups", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 2 });
      const a = await claim(db, id, w.catWoman);
      const b = await claim(db, id, w.freeAgent);
      if (!a.ok || !b.ok) throw new Error("claims failed");
      const decide = (
        claimId: typeof a.value,
        decision: "approved" | "declined",
      ) =>
        decideSubClaim(db, {
          claimId,
          decidedBy: w.aces.captain.userId,
          decision,
          now: NOW,
        });

      expect(await decide(a.value, "approved")).toEqual(ok(undefined));
      const status = async () =>
        (
          await db
            .select({ status: subRequest.status })
            .from(subRequest)
            .where(eq(subRequest.id, id))
        )[0]?.status;
      expect(await status()).toBe("open");
      expect(await decide(b.value, "approved")).toEqual(ok(undefined));
      expect(await status()).toBe("filled");
      expect(await decide(b.value, "declined")).toEqual({
        ok: false,
        error: "not_pending",
      });

      const told = await messagesLike(db, `sub_approved/${a.value}/`);
      expect(told.map((m) => m.userId)).toEqual([w.catWoman.userId]);
      const pickups = await pickupsFor(db, [w.gameId]);
      // Both claims share one timestamp, so their order is not defined.
      const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name);
      expect([...(pickups.get(w.gameId) ?? [])].sort(byName)).toEqual([
        { teamSeasonId: w.aces.id, name: "Cara S." },
        { teamSeasonId: w.aces.id, name: "Fran S." },
      ]);
      // The approved sub still sees the filled request on their sub page.
      const mine = await subRequestsFor(db, w.catWoman.userId, NOW);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ mine: "approved", left: 0 });
      // Others no longer see it once it is filled.
      expect(await subRequestsFor(db, w.catMan.userId, NOW)).toEqual([]);
    }));

  it("frees the spot when the captain declines, and the player cannot claim again", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 1 });
      const a = await claim(db, id, w.catWoman);
      if (!a.ok) throw new Error(a.error);
      expect(await claim(db, id, w.catMan)).toEqual({
        ok: false,
        error: "full",
      });
      await decideSubClaim(db, {
        claimId: a.value,
        decidedBy: w.aces.captain.userId,
        decision: "declined",
        now: NOW,
      });
      expect(
        (await messagesLike(db, `sub_declined/${a.value}/`)).map(
          (m) => m.userId,
        ),
      ).toEqual([w.catWoman.userId]);
      expect(await claim(db, id, w.catWoman)).toEqual({
        ok: false,
        error: "declined_before",
      });
      expect((await claim(db, id, w.catMan)).ok).toBe(true);
    }));

  it("reopens a filled request when an approved sub drops out", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 1 });
      const a = await claim(db, id, w.catWoman);
      if (!a.ok) throw new Error(a.error);
      await decideSubClaim(db, {
        claimId: a.value,
        decidedBy: w.aces.captain.userId,
        decision: "approved",
        now: NOW,
      });
      expect(
        await withdrawSubClaim(db, {
          requestId: id,
          userId: w.catWoman.userId,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      const [after] = await teamSubRequests(db, w.aces.id, NOW);
      expect(after?.status).toBe("open");
      expect(after?.claims.map((c) => c.status)).toEqual(["withdrawn"]);
      expect(
        (await messagesLike(db, `sub_withdrawn/${a.value}/`)).map(
          (m) => m.userId,
        ),
      ).toEqual([w.aces.captain.userId]);
      expect((await pickupsFor(db, [w.gameId])).get(w.gameId)).toBeUndefined();
      // Withdrawing is not a "no" from the captain: they may claim again.
      expect((await claim(db, id, w.catWoman)).ok).toBe(true);
    }));

  it("tells players holding a spot when the captain takes the request down", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      const id = await posted(db, w, { needed: 2 });
      await claim(db, id, w.catWoman);
      expect(await cancelSubRequest(db, { requestId: id, now: NOW })).toEqual(
        ok(undefined),
      );
      expect(
        (await messagesLike(db, `sub_cancelled/${id}/`)).map((m) => m.userId),
      ).toEqual([w.catWoman.userId]);
      expect(await teamSubRequests(db, w.aces.id, NOW)).toEqual([]);
      expect(await claim(db, id, w.catMan)).toEqual({
        ok: false,
        error: "closed",
      });
      // A new request can go up for the same game.
      expect((await post(db, w, { needed: 1 })).ok).toBe(true);
    }));
});

describe("the sub page", () => {
  it("lists open requests a player can take, and hides the asking team's own", () =>
    inRolledBackDb(async (db) => {
      const w = await subWorld(db);
      await posted(db, w, { needed: 1, womenNeeded: 1 });
      const forWoman = await subRequestsFor(db, w.catWoman.userId, NOW);
      expect(forWoman).toHaveLength(1);
      expect(forWoman[0]).toMatchObject({
        team: "Aces",
        blocked: null,
        left: 1,
        mine: null,
      });
      const forMan = await subRequestsFor(db, w.catMan.userId, NOW);
      expect(forMan[0]?.blocked).toBe("full");
      expect(await subRequestsFor(db, w.dogWoman.userId, NOW)).toMatchObject([
        { blocked: "busy" },
      ]);
      expect(await subRequestsFor(db, w.aces.captain.userId, NOW)).toEqual([]);
    }));
});

/**
 * Real commits on separate connections: a rolled-back transaction cannot
 * show what a second connection sees. Everything is deleted afterwards.
 */
async function connect(clients: Client[]) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  clients.push(client);
  return drizzle({ client, schema, casing: "snake_case" });
}

async function removeWorld(db: Db, leagueId: LeagueId) {
  const seasons = db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.leagueId, leagueId));
  const people = await db
    .select({ id: registration.userId })
    .from(registration)
    .where(inArray(registration.seasonId, seasons));
  const games = db
    .select({ id: game.id })
    .from(game)
    .where(inArray(game.seasonId, seasons));
  await db.delete(subRequest).where(inArray(subRequest.gameId, games));
  await db
    .delete(refereeAssignment)
    .where(inArray(refereeAssignment.gameId, games));
  await db.delete(game).where(inArray(game.seasonId, seasons));
  await db.delete(slot).where(inArray(slot.seasonId, seasons));
  const teamSeasons = db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(inArray(teamSeason.seasonId, seasons));
  await db
    .delete(rosterMembership)
    .where(inArray(rosterMembership.teamSeasonId, teamSeasons));
  await db.delete(registration).where(inArray(registration.seasonId, seasons));
  await db.delete(teamSeason).where(inArray(teamSeason.seasonId, seasons));
  await db.delete(team).where(eq(team.leagueId, leagueId));
  const venues = db
    .select({ id: venue.id })
    .from(venue)
    .where(eq(venue.leagueId, leagueId));
  await db.delete(field).where(inArray(field.venueId, venues));
  await db.delete(venue).where(eq(venue.leagueId, leagueId));
  await db.delete(season).where(eq(season.leagueId, leagueId));
  await db.delete(league).where(eq(league.id, leagueId));
  if (people.length > 0)
    await db.delete(user).where(
      inArray(
        user.id,
        people.map((p) => p.id),
      ),
    );
}

describe("two players claiming the last spot at once", () => {
  it("gives it to exactly one of them", async () => {
    const clients: Client[] = [];
    const setup = await connect(clients);
    const w = await subWorld(setup);
    try {
      const id = await posted(setup, w, { needed: 2 });
      // One spot is already taken, so one is left.
      expect((await claim(setup, id, w.catMan)).ok).toBe(true);
      const [a, b] = [await connect(clients), await connect(clients)];
      for (let round = 0; round < 5; round++) {
        const results = await Promise.all([
          claim(a, id, w.catWoman),
          claim(b, id, w.freeAgent),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toEqual([
          { ok: false, error: "full" },
        ]);
        const holding = await setup
          .select({ userId: subClaim.userId })
          .from(subClaim)
          .where(
            and(
              eq(subClaim.subRequestId, id),
              inArray(subClaim.status, ["pending", "approved"]),
            ),
          );
        expect(holding).toHaveLength(2);
        // Free the spot again for the next round.
        const winner = results[0]?.ok ? w.catWoman : w.freeAgent;
        await withdrawSubClaim(setup, {
          requestId: id,
          userId: winner.userId,
          now: NOW,
        });
      }
    } finally {
      await removeWorld(setup, w.leagueId);
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("lets only one captain answer a claim when two answer at once", async () => {
    const clients: Client[] = [];
    const setup = await connect(clients);
    const w = await subWorld(setup);
    try {
      const coCaptain = w.aces.players[0]!;
      const id = await posted(setup, w, { needed: 1 });
      const held = await claim(setup, id, w.catWoman);
      if (!held.ok) throw new Error(held.error);
      const [a, b] = [await connect(clients), await connect(clients)];
      const results = await Promise.all([
        decideSubClaim(a, {
          claimId: held.value,
          decidedBy: w.aces.captain.userId,
          decision: "approved",
          now: NOW,
        }),
        decideSubClaim(b, {
          claimId: held.value,
          decidedBy: coCaptain.userId,
          decision: "declined",
          now: NOW,
        }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, error: "not_pending" },
      ]);
    } finally {
      await removeWorld(setup, w.leagueId);
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
