import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId, SlotId, TeamSeasonId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { game, slot } from "../schema/game";
import { pickemHidden, pickemPick } from "../schema/pickem";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  ownGamesAllowed,
  pickemPage,
  savePicks,
  setHidden,
  setOwnGamesAllowed,
} from "./pickem";
import type { Db } from "./schedule";

afterAll(closePool);

// Saturday Oct 10, noon in New York.
const NOW = new Date("2026-10-10T16:00:00Z");
// Games end at 9 pm New York time on these Mondays (01:00 UTC next day).
const LAST_MONDAY = new Date("2026-10-06T01:00:00Z"); // Oct 5
const NEXT_MONDAY = new Date("2026-10-13T01:00:00Z"); // Oct 12

/**
 * Two finished game days and a coming one: Aces vs Bees and Cats vs Dogs
 * on each. Everyone is named, the season is under way, and three fans
 * who are on no team pick too.
 */
async function pickemWorld(db: Db) {
  const w = await messagingWorld(db);
  await db
    .update(season)
    .set({ status: "in_progress" })
    .where(eq(season.id, w.season.id));
  const cats = await w.entry("Cats");
  const dogs = await w.entry("Dogs");
  const [ana, bo, cy] = [
    await w.person("ana"),
    await w.person("bo"),
    await w.person("cy"),
  ] as [Player, Player, Player];
  await db.insert(profile).values(
    [
      [ana, "Ana", "Alpha"],
      [bo, "Bo", "Beta"],
      [cy, "Cy", "Gamma"],
      [w.aces.captain, "Robin", "Example"],
    ].map(([p, firstName, lastName]) => ({
      userId: (p as Player).userId,
      firstName: firstName as string,
      lastName: lastName as string,
    })),
  );
  const at = (base: Date, days: number) =>
    new Date(base.getTime() + days * 86_400_000);
  const games = {
    weekOneAB: await w.gameBetween(w.aces.id, w.bees.id, at(LAST_MONDAY, -7)),
    weekOneCD: await w.gameBetween(cats, dogs, at(LAST_MONDAY, -7), {
      onField: await w.addField("Field 3"),
    }),
    lastAB: await w.gameBetween(w.aces.id, w.bees.id, LAST_MONDAY),
    lastCD: await w.gameBetween(cats, dogs, LAST_MONDAY, {
      onField: await w.addField("Field 4"),
    }),
    nextAB: await w.gameBetween(w.aces.id, w.bees.id, NEXT_MONDAY),
    nextCD: await w.gameBetween(cats, dogs, at(NEXT_MONDAY, 1 / 24), {
      onField: await w.addField("Field 5"),
    }),
  };
  return { ...w, cats, dogs, ana, bo, cy, games };
}

type Ids = { gameId: GameId; slotId: SlotId };

/** Writes a confirmed result the way settling a score does. */
async function finish(db: Db, g: Ids, scoreA: number, scoreB: number) {
  await db
    .update(game)
    .set({ status: "final", scoreA, scoreB, finalizedAt: NOW })
    .where(eq(game.id, g.gameId));
}

/** Picks made before the games, straight into the table (no lock check). */
async function picked(
  db: Db,
  who: Player,
  rows: [Ids, TeamSeasonId][],
): Promise<void> {
  await db.insert(pickemPick).values(
    rows.map(([g, teamSeasonId]) => ({
      gameId: g.gameId,
      slotId: g.slotId,
      userId: who.userId,
      teamSeasonId,
    })),
  );
}

const pick = (db: Db, who: Player, rows: [Ids, TeamSeasonId][], now = NOW) =>
  savePicks(db, {
    userId: who.userId,
    picks: new Map(rows.map(([g, t]) => [g.gameId, t])),
    now,
  });

describe("saving picks", () => {
  it("saves and changes picks for open games, tied to their slot", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      expect(
        await pick(db, w.ana, [
          [w.games.nextAB, w.aces.id],
          [w.games.nextCD, w.cats],
        ]),
      ).toEqual({ saved: 2, refused: [] });
      await pick(db, w.ana, [[w.games.nextAB, w.bees.id]]);
      const rows = await db
        .select()
        .from(pickemPick)
        .where(eq(pickemPick.userId, w.ana.userId));
      expect(
        rows.map((r) => [r.gameId, r.teamSeasonId, r.slotId]).sort(),
      ).toEqual(
        [
          [w.games.nextAB.gameId, w.bees.id, w.games.nextAB.slotId],
          [w.games.nextCD.gameId, w.cats, w.games.nextCD.slotId],
        ].sort(),
      );
    });
  });

  it("refuses a game that has started, a team not in it and an unknown game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      const started = new Date(NEXT_MONDAY.getTime() - 3_600_000);
      const result = await pick(
        db,
        w.ana,
        [
          [w.games.nextAB, w.aces.id],
          [w.games.nextCD, w.aces.id],
          [
            {
              gameId: "00000000-0000-4000-8000-000000000000" as GameId,
              slotId: w.games.nextAB.slotId,
            },
            w.aces.id,
          ],
        ],
        started,
      );
      expect(result.saved).toBe(0);
      expect(result.refused.map((r) => r.error).sort()).toEqual([
        "locked",
        "not_found",
        "not_in_game",
      ]);
    });
  });

  it("refuses a rained-out game", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, w.games.nextAB.slotId));
      const result = await pick(db, w.ana, [[w.games.nextAB, w.aces.id]]);
      expect(result.refused).toEqual([
        { gameId: w.games.nextAB.gameId, error: "locked" },
      ]);
    });
  });

  it("follows the league's setting on picking your own team's games, and audits it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      const captain = w.aces.captain;
      expect(await ownGamesAllowed(db)).toBe(true);
      expect(
        (await pick(db, captain, [[w.games.nextAB, w.aces.id]])).saved,
      ).toBe(1);

      await setOwnGamesAllowed(db, {
        leagueId: w.leagueId,
        on: false,
        actorId: captain.userId,
      });
      expect(await ownGamesAllowed(db)).toBe(false);
      const result = await pick(db, captain, [
        [w.games.nextAB, w.bees.id],
        [w.games.nextCD, w.cats],
      ]);
      expect(result).toEqual({
        saved: 1,
        refused: [{ gameId: w.games.nextAB.gameId, error: "own_team" }],
      });
      // Saving the same choice again records nothing new.
      await setOwnGamesAllowed(db, {
        leagueId: w.leagueId,
        on: false,
        actorId: captain.userId,
      });
      const audits = await db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "pickem.own_games"),
            eq(auditLog.entityId, w.leagueId),
          ),
        );
      expect(audits).toEqual([
        {
          before: { ownGamesAllowed: true },
          after: { ownGamesAllowed: false },
        },
      ]);

      const page = await pickemPage(db, captain.userId, NOW, null);
      expect(page.ownGamesAllowed).toBe(false);
      expect(page.coming?.games.map((g) => [g.mine, g.myPick])).toEqual([
        [true, w.aces.id],
        [false, w.cats],
      ]);
    });
  });
});

describe("the pick'em page", () => {
  it("shows the coming game day with each game's lock and the player's picks", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      await pick(db, w.ana, [[w.games.nextCD, w.dogs]]);
      const page = await pickemPage(db, w.ana.userId, NOW, null);
      expect(page.season?.name).toBe("Fall 2026");
      expect(page.coming?.day).toBe("2026-10-12");
      expect(
        page.coming?.games.map((g) => [g.teamAName, g.locked, g.myPick]),
      ).toEqual([
        ["Aces", false, null],
        ["Cats", false, w.dogs],
      ]);
      // After the first game starts, the day stays with that game locked.
      const between = new Date(NEXT_MONDAY.getTime() - 1_800_000);
      const later = await pickemPage(db, w.ana.userId, between, null);
      expect(later.coming?.games.map((g) => g.locked)).toEqual([true, false]);
    });
  });

  it("drops a pick when its game leaves the slot it was made for", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      await pick(db, w.ana, [[w.games.nextAB, w.aces.id]]);
      // Rained out and moved a week later.
      const makeup = await w.gameBetween(
        w.cats,
        w.dogs,
        new Date(NEXT_MONDAY.getTime() + 7 * 86_400_000),
      );
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.id, w.games.nextAB.slotId));
      await db
        .update(game)
        .set({ slotId: makeup.slotId })
        .where(eq(game.id, w.games.nextAB.gameId));
      const page = await pickemPage(db, w.ana.userId, NOW, null);
      const moved = page.coming?.games.find(
        (g) => g.id === w.games.nextAB.gameId,
      );
      expect(page.coming?.day).toBe("2026-10-12");
      expect(moved).toBeUndefined();
    });
  });
});

describe("leaderboards", () => {
  /**
   * Week one: Aces beat Bees 5-3, Cats and Dogs tie 4-4.
   * Last week: Bees beat Aces 6-2, Dogs win by forfeit (void).
   * Ana: Aces, Cats, Bees, Dogs = 2 right of 2 scored.
   * Bo: Aces, Dogs, Aces = 1 right of 2 scored.
   * Cy: Bees, Bees = 1 right of 2 scored.
   * Robin: Aces in week one only = 1 right of 1.
   */
  async function scoredWorld(db: Db) {
    const w = await pickemWorld(db);
    const { weekOneAB, weekOneCD, lastAB, lastCD } = w.games;
    await picked(db, w.ana, [
      [weekOneAB, w.aces.id],
      [weekOneCD, w.cats],
      [lastAB, w.bees.id],
      [lastCD, w.dogs],
    ]);
    await picked(db, w.bo, [
      [weekOneAB, w.aces.id],
      [weekOneCD, w.dogs],
      [lastAB, w.aces.id],
    ]);
    await picked(db, w.cy, [
      [weekOneAB, w.bees.id],
      [lastAB, w.bees.id],
    ]);
    await picked(db, w.aces.captain, [[weekOneAB, w.aces.id]]);
    await finish(db, weekOneAB, 5, 3);
    await finish(db, weekOneCD, 4, 4);
    await finish(db, lastAB, 2, 6);
    await db
      .update(game)
      .set({ status: "forfeit", forfeitBy: w.cats, finalizedAt: NOW })
      .where(eq(game.id, lastCD.gameId));
    return w;
  }

  const board = (rows: { name: string; place: number; correct: number }[]) =>
    rows.map((r) => [r.place, r.name, r.correct]);

  it("ranks the season by right picks, ties sharing a place, voids counting for nobody", async () => {
    await inRolledBackDb(async (db) => {
      const w = await scoredWorld(db);
      const page = await pickemPage(db, w.ana.userId, NOW, null);
      expect(board(page.seasonBoard)).toEqual([
        [1, "Ana A.", 2],
        [2, "Robin E.", 1],
        [2, "Bo B.", 1],
        [2, "Cy G.", 1],
      ]);
      expect(page.seasonBoard.map((r) => r.scored)).toEqual([2, 1, 2, 2]);
      expect(page.me).toEqual({ correct: 2, scored: 2, picks: 4 });
      expect(page.scoredDays).toEqual(["2026-10-05", "2026-09-28"]);
    });
  });

  it("ranks one game day at a time, the latest by default", async () => {
    await inRolledBackDb(async (db) => {
      const w = await scoredWorld(db);
      const latest = await pickemPage(db, w.bo.userId, NOW, null);
      expect(latest.day).toBe("2026-10-05");
      expect(board(latest.dayBoard)).toEqual([
        [1, "Ana A.", 1],
        [1, "Cy G.", 1],
        [3, "Bo B.", 0],
      ]);
      const first = await pickemPage(db, w.bo.userId, NOW, "2026-09-28");
      expect(board(first.dayBoard)).toEqual([
        [1, "Ana A.", 1],
        [1, "Bo B.", 1],
        [1, "Robin E.", 1],
        [4, "Cy G.", 0],
      ]);
      // A day with nothing scored falls back to the latest.
      expect((await pickemPage(db, w.bo.userId, NOW, "2026-10-12")).day).toBe(
        "2026-10-05",
      );
    });
  });

  it("leaves out a player who hides, while they still see their record", async () => {
    await inRolledBackDb(async (db) => {
      const w = await scoredWorld(db);
      await setHidden(db, w.ana.userId, true);
      await setHidden(db, w.ana.userId, true);
      const page = await pickemPage(db, w.ana.userId, NOW, null);
      expect(page.hidden).toBe(true);
      expect(page.seasonBoard.map((r) => r.name)).not.toContain("Ana A.");
      expect(board(page.seasonBoard)[0]).toEqual([1, "Robin E.", 1]);
      expect(page.me.correct).toBe(2);
      await setHidden(db, w.ana.userId, false);
      expect(
        (await pickemPage(db, w.ana.userId, NOW, null)).seasonBoard[0]?.name,
      ).toBe("Ana A.");
    });
  });

  it("voids a pick made for a slot the game was rained out of", async () => {
    await inRolledBackDb(async (db) => {
      const w = await scoredWorld(db);
      // Week one's Aces vs Bees was really played on a makeup date.
      const makeup = await w.gameBetween(
        w.cats,
        w.dogs,
        new Date(LAST_MONDAY.getTime() + 86_400_000),
      );
      await db
        .update(game)
        .set({ slotId: makeup.slotId })
        .where(eq(game.id, w.games.weekOneAB.gameId));
      const page = await pickemPage(db, w.ana.userId, NOW, null);
      expect(board(page.seasonBoard)).toEqual([
        [1, "Ana A.", 1],
        [1, "Cy G.", 1],
        [3, "Bo B.", 0],
      ]);
    });
  });
});

describe("a person's own data", () => {
  it("is in their export and goes when they delete their account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await pickemWorld(db);
      await pick(db, w.ana, [[w.games.nextAB, w.aces.id]]);
      await setHidden(db, w.ana.userId, true);
      const data = await personalData(db, w.ana.userId, NOW);
      expect(data?.pickem.hiddenFromLeaderboards).toBe(true);
      expect(data?.pickem.picks.map((p) => [p.season, p.picked])).toEqual([
        ["Fall 2026", "Aces"],
      ]);

      expect((await deleteAccount(db, w.ana.userId, NOW)).ok).toBe(true);
      expect(
        await db
          .select()
          .from(pickemPick)
          .where(eq(pickemPick.userId, w.ana.userId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(pickemHidden)
          .where(eq(pickemHidden.userId, w.ana.userId)),
      ).toEqual([]);
    });
  });
});
