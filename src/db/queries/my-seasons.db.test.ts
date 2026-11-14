import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { season } from "../schema/season";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { myCurrentSeasons } from "./registration";

afterAll(closePool);

describe("myCurrentSeasons", () => {
  it("gives each player their team in a running season, so home can link to it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      await db
        .update(season)
        .set({ status: "in_progress" })
        .where(eq(season.id, w.season.id));
      const of = async (userId: (typeof w.freeAgent)["userId"]) =>
        (await myCurrentSeasons(db, userId)).map((r) => [
          r.seasonSlug,
          r.teamName,
          r.role,
        ]);

      expect(await of(w.aces.captain.userId)).toEqual([
        [w.season.slug, "Aces", "captain"],
      ]);
      // Still paying counts: they're on the team.
      expect(await of(w.bees.players[0]!.userId)).toEqual([
        [w.season.slug, "Bees", "player"],
      ]);
      // Registered but not on a team yet.
      expect(await of(w.freeAgent.userId)).toEqual([
        [w.season.slug, null, null],
      ]);
      expect(await of(w.cancelled.userId)).toEqual([]);
    });
  });

  it("leaves out a season once it's over", async () => {
    await inRolledBackDb(async (db) => {
      const w = await messagingWorld(db);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await myCurrentSeasons(db, w.aces.captain.userId)).toEqual([]);
    });
  });
});
