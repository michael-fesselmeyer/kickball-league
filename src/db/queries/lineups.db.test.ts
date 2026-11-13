import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { UserId } from "@/domain/ids";
import { lineupAccess } from "@/domain/lineup/access";
import { incident, suspension } from "../schema/discipline";
import { game, gameRsvp } from "../schema/game";
import { gameLineupSpot } from "../schema/lineup";
import { profile } from "../schema/profile";
import { subClaim, subRequest } from "../schema/subs";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import type { Db } from "./schedule";
import {
  lineupCandidates,
  lineupGame,
  mySpots,
  previousLineup,
  savedFor,
  savedLineups,
  saveLineup,
} from "./lineups";
import { required } from "./rows";
import { loadSubject } from "./subject";

afterAll(closePool);

const NOW = new Date("2026-10-01T16:00:00Z");

type Side = "woman" | "man" | null;

/** Aces with a captain and five more players, each with a side, and a game against Bees. */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const sides: Side[] = ["man", "woman", "woman", "man", "woman", null];
  const extra = [];
  for (let i = 0; i < 3; i += 1) {
    const p = await w.person(`ace-x${i}`);
    await w.join(w.aces.id, p);
    extra.push(p);
  }
  const aces = [w.aces.captain, ...w.aces.players, ...extra];
  const names = ["Avery", "Blair", "Casey", "Drew", "Emery", "Finley"];
  for (const [i, p] of aces.entries())
    await db.insert(profile).values({
      userId: p.userId,
      firstName: names[i] ?? "Kai",
      lastName: "Testwood",
      lineupGender: sides[i] ?? null,
    });
  const ref = await w.person("ref");
  for (const p of [w.bees.captain, ref])
    await db.insert(profile).values({ userId: p.userId, firstName: "Sam" });
  const later = await w.gameBetween(
    w.aces.id,
    w.bees.id,
    new Date("2026-10-06T00:00:00Z"),
    {
      refereeId: ref.userId,
    },
  );
  const earlier = await w.gameBetween(
    w.aces.id,
    w.bees.id,
    new Date("2026-09-29T00:00:00Z"),
  );
  async function rsvp(
    gameId: typeof later.gameId,
    userId: UserId,
    status: "in" | "out" | "maybe",
  ) {
    await db
      .insert(gameRsvp)
      .values({ gameId, userId, teamSeasonId: w.aces.id, status });
  }
  return { ...w, acesKickers: aces, ref, later, earlier, rsvp };
}

describe("lineup candidates", () => {
  it("are the players who said they're in, then approved pickups", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [cap, p1, p2, x0] = w.acesKickers;
      if (!cap || !p1 || !p2 || !x0) throw new Error("world");
      await w.rsvp(w.later.gameId, cap.userId, "in");
      await w.rsvp(w.later.gameId, p1.userId, "in");
      await w.rsvp(w.later.gameId, p2.userId, "out");
      await w.rsvp(w.later.gameId, x0.userId, "maybe");
      const pickup = await w.person("pickup");
      await db
        .insert(profile)
        .values({ userId: pickup.userId, firstName: "Pat", lastName: "Q" });
      const request = required(
        (
          await db
            .insert(subRequest)
            .values({
              gameId: w.later.gameId,
              teamSeasonId: w.aces.id,
              requestedBy: cap.userId,
              needed: 1,
              closesAt: new Date("2026-10-05T23:00:00Z"),
            })
            .returning({ id: subRequest.id })
        )[0],
        "request",
      );
      await db.insert(subClaim).values({
        subRequestId: request.id,
        userId: pickup.userId,
        status: "approved",
        lineupGender: "woman",
      });
      const found = await lineupCandidates(db, w.later.gameId, w.aces.id, NOW);
      expect(found).toEqual([
        { id: cap.userId, name: "Avery T.", side: "man", pickup: false },
        { id: p1.userId, name: "Blair T.", side: "woman", pickup: false },
        { id: pickup.userId, name: "Pat Q.", side: "woman", pickup: true },
      ]);
      expect(
        await lineupCandidates(db, w.later.gameId, w.bees.id, NOW),
      ).toEqual([]);
    });
  });
});

describe("saving a kicking order", () => {
  it("saves, replaces and reports where each player kicks", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const ids = w.acesKickers.map((p) => p.userId);
      for (const id of ids) await w.rsvp(w.later.gameId, id, "in");
      const [a, b, c, d, e, f] = ids;
      if (!a || !b || !c || !d || !e || !f) throw new Error("world");
      // Sides: a man, b woman, c woman, d man, e woman, f none.
      const first = await saveLineup(db, {
        gameId: w.later.gameId,
        teamSeasonId: w.aces.id,
        order: [b, c, e, a, d, f],
        savedBy: a,
        now: NOW,
      });
      expect(first).toEqual({ ok: true, value: { runBreaks: 1 } });
      const second = await saveLineup(db, {
        gameId: w.later.gameId,
        teamSeasonId: w.aces.id,
        order: [b, c, a, e, d, f],
        savedBy: a,
        now: NOW,
      });
      expect(second).toEqual({ ok: true, value: { runBreaks: 0 } });
      const saved = (await savedLineups(db, w.later.gameId)).get(w.aces.id);
      expect(saved?.runBreaks).toBe(0);
      expect(saved?.spots.map((s) => [s.position, s.name])).toEqual([
        [1, "Blair T."],
        [2, "Casey T."],
        [3, "Avery T."],
        [4, "Emery T."],
        [5, "Drew T."],
        [6, "Finley T."],
      ]);
      // Saving replaced the spots rather than adding to them.
      const lineupId = required(saved, "saved").id;
      expect(
        await db
          .select()
          .from(gameLineupSpot)
          .where(eq(gameLineupSpot.lineupId, lineupId)),
      ).toHaveLength(6);
      expect(
        (await mySpots(db, e, [w.later.gameId, w.earlier.gameId])).get(
          w.later.gameId,
        ),
      ).toEqual({
        position: 4,
        of: 6,
      });
      expect(
        await savedFor(db, w.aces.id, [w.later.gameId, w.earlier.gameId]),
      ).toEqual(new Set([w.later.gameId]));
    });
  });

  it("refuses kickers who aren't coming, repeats, other games and finished games", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [a, b] = w.acesKickers.map((p) => p.userId);
      if (!a || !b) throw new Error("world");
      await w.rsvp(w.later.gameId, a, "in");
      await w.rsvp(w.later.gameId, b, "out");
      const save = (
        order: UserId[],
        over: Partial<Parameters<typeof saveLineup>[1]> = {},
      ) =>
        saveLineup(db, {
          gameId: w.later.gameId,
          teamSeasonId: w.aces.id,
          order,
          savedBy: a,
          now: NOW,
          ...over,
        });
      expect(await save([a, b])).toEqual({ ok: false, error: "not_available" });
      expect(await save([a, a])).toEqual({ ok: false, error: "repeated" });
      expect(await save([])).toEqual({ ok: false, error: "empty" });
      const other = await w.entry("Cats");
      expect(await save([a], { teamSeasonId: other })).toEqual({
        ok: false,
        error: "not_your_game",
      });
      await db
        .update(game)
        .set({ status: "cancelled" })
        .where(eq(game.id, w.later.gameId));
      expect(await save([a])).toEqual({ ok: false, error: "game_over" });
      expect((await savedLineups(db, w.later.gameId)).size).toBe(0);
    });
  });

  it("copies from the team's latest earlier game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [a, b, c] = w.acesKickers.map((p) => p.userId);
      if (!a || !b || !c) throw new Error("world");
      for (const id of [a, b, c]) await w.rsvp(w.earlier.gameId, id, "in");
      expect(await previousLineup(db, w.later.gameId, w.aces.id)).toBeNull();
      await saveLineup(db, {
        gameId: w.earlier.gameId,
        teamSeasonId: w.aces.id,
        order: [c, a, b],
        savedBy: a,
        now: NOW,
      });
      expect(await previousLineup(db, w.later.gameId, w.aces.id)).toEqual({
        gameId: w.earlier.gameId,
        order: [c, a, b],
      });
      // Nothing comes before the earlier game.
      expect(await previousLineup(db, w.earlier.gameId, w.aces.id)).toBeNull();
    });
  });
});

describe("suspended players", () => {
  it("are left out of the candidates and can't be saved into an order", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [a, b] = w.acesKickers.map((p) => p.userId);
      if (!a || !b) throw new Error("world");
      await w.rsvp(w.later.gameId, a, "in");
      await w.rsvp(w.later.gameId, b, "in");
      const filed = required(
        (
          await db
            .insert(incident)
            .values({
              gameId: w.earlier.gameId,
              kind: "unsportsmanlike",
              details: "Argued every call",
              reportedBy: w.ref.userId,
              reporterRole: "referee",
            })
            .returning({ id: incident.id })
        )[0],
        "incident",
      );
      await db.insert(suspension).values({
        userId: b,
        incidentId: filed.id,
        seasonId: w.season.id,
        scope: "season",
        startsAt: new Date("2026-09-30T16:00:00Z"),
      });
      const found = await lineupCandidates(db, w.later.gameId, w.aces.id, NOW);
      expect(found.map((k) => k.id)).toEqual([a]);
      expect(
        await saveLineup(db, {
          gameId: w.later.gameId,
          teamSeasonId: w.aces.id,
          order: [a, b],
          savedBy: a,
          now: NOW,
        }),
      ).toEqual({ ok: false, error: "not_available" });
    });
  });
});

describe("who sees an order", () => {
  it("follows the roles loaded from the database", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const g = required(await lineupGame(db, w.later.gameId), "game");
      const dayBefore = new Date("2026-10-04T16:00:00Z");
      const gameDay = new Date("2026-10-05T16:00:00Z");
      const access = async (
        userId: UserId,
        team: typeof w.aces.id,
        now: Date,
      ) => lineupAccess(await loadSubject(db, userId), g, team, now);
      expect(await access(w.aces.captain.userId, w.aces.id, dayBefore)).toBe(
        "edit",
      );
      expect(await access(w.bees.captain.userId, w.aces.id, dayBefore)).toBe(
        "none",
      );
      expect(await access(w.bees.captain.userId, w.aces.id, gameDay)).toBe(
        "order",
      );
      expect(await access(w.ref.userId, w.aces.id, dayBefore)).toBe("none");
      expect(await access(w.ref.userId, w.aces.id, gameDay)).toBe("order");
      const player = required(w.acesKickers[1], "player").userId;
      expect(await access(player, w.aces.id, gameDay)).toBe("none");
    });
  });
});
