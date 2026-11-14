import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { awardPoll } from "@/db/schema/awards";
import { game, slot } from "@/db/schema/game";
import { scheduleVersion } from "@/db/schema/schedule";
import { season } from "@/db/schema/season";
import { messagingWorld } from "@/db/test/messaging-world";
import { closePool, inRolledBackDb } from "@/db/test/transaction";
import type { Db } from "@/db/queries/schedule";
import type { SlotId } from "@/domain/ids";
import { DEFAULT_WEIGHTS } from "@/domain/scheduler/types";
import { catchUpDemoLeague } from "./shift-weeks";

afterAll(closePool);

/** 9 pm New York on a date: the end of an 8 pm game. */
const ninePm = (date: string, edt: boolean) =>
  new Date(`${date}T${edt ? "01" : "02"}:00:00Z`);

/** A season being played, games on three Tuesdays at 8 pm, the first final. */
async function playing(db: Db) {
  const w = await messagingWorld(db);
  await db
    .update(season)
    .set({
      status: "in_progress",
      startsOn: "2026-09-15",
      endsOn: "2026-09-29",
    })
    .where(eq(season.id, w.season.id));
  // 8 pm EDT on Sep 15, 22 and 29: 9 pm ends at 01:00Z the next day.
  const played = await w.gameEnding(ninePm("2026-09-16", true));
  await db
    .update(game)
    .set({
      status: "final",
      scoreA: 5,
      scoreB: 3,
      finalizedAt: new Date("2026-09-16T01:30:00Z"),
    })
    .where(eq(game.id, played.gameId));
  const next = await w.gameEnding(ninePm("2026-09-23", true));
  const later = await w.gameEnding(ninePm("2026-09-30", true));
  return { w, played, next, later };
}

const startOf = async (db: Db, slotId: SlotId) =>
  (
    await db
      .select({ startsAt: slot.startsAt })
      .from(slot)
      .where(eq(slot.id, slotId))
  )[0]?.startsAt.toISOString();

describe("catchUpDemoLeague", () => {
  it("moves weekly games by a week without colliding on the way", async () => {
    await inRolledBackDb(async (db) => {
      const { next, later } = await playing(db);
      // Wednesday Sep 23: the next unplayed game (Tue Sep 22) is a day past,
      // so one week. Sep 22's slot takes Sep 29's time, which Sep 29's own
      // slot (same field) also leaves: a naive update would collide.
      const now = new Date("2026-09-23T15:00:00Z");
      expect(await catchUpDemoLeague(db, { now, ranFrom: now })).toBe(1);
      expect(await startOf(db, next.slotId)).toBe("2026-09-30T00:00:00.000Z");
      expect(await startOf(db, later.slotId)).toBe("2026-10-07T00:00:00.000Z");
    });
  });

  it("keeps 8 pm across the change to winter time, and leaves now-relative rows alone", async () => {
    await inRolledBackDb(async (db) => {
      const { w, played, next } = await playing(db);
      // A poll the seed dates from now, and a publish stamped while it ran.
      const ranFrom = new Date("2026-11-14T14:59:00Z");
      const now = new Date("2026-11-14T15:00:00Z");
      const [poll] = await db
        .insert(awardPoll)
        .values({
          seasonId: w.season.id,
          kind: "season",
          category: "mvp",
          title: "MVP",
          opensAt: new Date("2026-11-13T15:00:00Z"),
          closesAt: new Date("2026-11-21T15:00:00Z"),
        })
        .returning({ id: awardPoll.id });
      const [version] = await db
        .insert(scheduleVersion)
        .values({
          seasonId: w.season.id,
          versionNo: 1,
          origin: "generated",
          status: "published",
          publishedAt: new Date("2026-11-14T14:59:30Z"),
          inputSnapshot: {
            teams: [],
            slots: [
              {
                id: next.slotId,
                fieldId: "field",
                date: "2026-09-22",
                startsAt: "2026-09-23T00:00:00.000Z",
                endsAt: "2026-09-23T01:00:00.000Z",
                timeIndex: 0,
                kind: "regular",
              },
            ],
            rounds: 1,
            gamesPerTeamPerDay: 1,
            reservePerDay: 0,
            constraints: [],
            locked: [],
            weights: DEFAULT_WEIGHTS,
            seed: 1,
          },
        })
        .returning({ id: scheduleVersion.id });

      // Saturday Nov 14: from Tue Sep 22, 8 weeks makes it Tue Nov 17.
      expect(await catchUpDemoLeague(db, { now, ranFrom })).toBe(8);
      // 8 pm EST is 01:00Z: the local time held, the UTC hour moved.
      expect(await startOf(db, next.slotId)).toBe("2026-11-18T01:00:00.000Z");
      expect(await startOf(db, played.slotId)).toBe("2026-11-11T01:00:00.000Z");
      const [s] = await db
        .select({ startsOn: season.startsOn, endsOn: season.endsOn })
        .from(season)
        .where(eq(season.id, w.season.id));
      expect(s).toEqual({ startsOn: "2026-11-10", endsOn: "2026-11-24" });

      const [p] = await db
        .select({ closesAt: awardPoll.closesAt })
        .from(awardPoll)
        .where(eq(awardPoll.id, poll!.id));
      expect(p?.closesAt.toISOString()).toBe("2026-11-21T15:00:00.000Z");
      const [v] = await db
        .select({
          publishedAt: scheduleVersion.publishedAt,
          inputSnapshot: scheduleVersion.inputSnapshot,
        })
        .from(scheduleVersion)
        .where(eq(scheduleVersion.id, version!.id));
      expect(v?.publishedAt?.toISOString()).toBe("2026-11-14T14:59:30.000Z");
      expect(v?.inputSnapshot).toMatchObject({
        slots: [{ date: "2026-11-17", startsAt: "2026-11-18T01:00:00.000Z" }],
      });
    });
  });

  it("does nothing when the next game day is still ahead", async () => {
    await inRolledBackDb(async (db) => {
      const { next } = await playing(db);
      const now = new Date("2026-09-20T15:00:00Z");
      expect(await catchUpDemoLeague(db, { now, ranFrom: now })).toBe(0);
      expect(await startOf(db, next.slotId)).toBe("2026-09-23T00:00:00.000Z");
    });
  });
});
