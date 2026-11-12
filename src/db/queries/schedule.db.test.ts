import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { parseId, type ScheduleVersionId, type SeasonId } from "@/domain/ids";
import { generate } from "@/domain/scheduler/generate";
import { reschedule } from "@/domain/scheduler/reschedule";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { scheduleVersion, teamConstraint } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import { recordAudit } from "./audit";
import { required } from "./rows";
import {
  type Db,
  loadSchedulerInput,
  loadVersion,
  publishVersion,
  saveVersion,
} from "./schedule";

afterAll(closePool);

const options = { rounds: 7, reservePerDay: 2, seed: 7 };

/**
 * The worked example in the database: 8 teams, two fields and three times
 * on seven Sundays, in New York time.
 */
async function world(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `db-test-${tag}@example.test` })
    .returning({ id: user.id });
  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `test-${tag}` })
    .returning({ id: league.id });
  const [sn] = await db
    .insert(season)
    .values({
      leagueId: lg!.id,
      name: "Spring",
      slug: "spring",
      startsOn: "2027-04-04",
      endsOn: "2027-05-16",
      feeModel: "per_team",
      teamFeeCents: 120000,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  const [vn] = await db
    .insert(venue)
    .values({ leagueId: lg!.id, name: "McCarren Park", slug: "mccarren-park" })
    .returning({ id: venue.id });
  const fields = await db
    .insert(field)
    .values([1, 2].map((n) => ({ venueId: vn!.id, name: `Field ${n}` })))
    .returning({ id: field.id });
  const sundays = [4, 11, 18, 25].map(
    (d) => `2027-04-${String(d).padStart(2, "0")}`,
  );
  sundays.push("2027-05-02", "2027-05-09", "2027-05-16");
  // 10:00, 11:30 and 1:00 New York time (EDT, UTC-4).
  const starts = ["14:00", "15:30", "17:00"];
  await db.insert(slot).values(
    sundays.flatMap((date) =>
      starts.flatMap((time, timeIndex) =>
        fields.map((f) => {
          const startsAt = new Date(`${date}T${time}:00Z`);
          return {
            seasonId: sn!.id,
            fieldId: f.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 90 * 60_000),
            timeIndex,
          };
        }),
      ),
    ),
  );
  const teams = await db
    .insert(team)
    .values(
      "ABCDEFGH".split("").map((l) => ({
        leagueId: lg!.id,
        name: `Team ${l}`,
        slug: `team-${l.toLowerCase()}`,
      })),
    )
    .returning({ id: team.id });
  const entries = await db
    .insert(teamSeason)
    .values(teams.map((t) => ({ teamId: t.id, seasonId: sn!.id })))
    .returning({ id: teamSeason.id });
  return {
    adminId: admin!.id,
    seasonId: sn!.id,
    entries: entries.map((e) => e.id),
  };
}

describe("loadSchedulerInput", () => {
  it("builds the scheduler's input from the season", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await db.insert(teamConstraint).values({
        teamSeasonId: w.entries[0]!,
        kind: "unavailable",
        onDate: "2027-04-11",
      });
      const result = await loadSchedulerInput(db, w.seasonId, options);
      if (!result.ok) throw new Error(result.error);
      const input = result.value;
      expect(input.teams).toHaveLength(8);
      expect(input.slots).toHaveLength(42);
      // Slots are dated in the league's time zone, and keep their time index.
      expect(input.slots[0]).toMatchObject({
        date: "2027-04-04",
        timeIndex: 0,
      });
      expect(input.constraints).toEqual([
        {
          teamId: w.entries[0],
          kind: "unavailable",
          weight: 1,
          date: "2027-04-11",
        },
      ]);
      expect(input).toMatchObject({
        rounds: 7,
        reservePerDay: 2,
        seed: 7,
        gamesPerTeamPerDay: 1,
      });
    }));

  it("leaves out waitlisted teams and cancelled slots, and refuses an unknown season", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await db
        .update(teamSeason)
        .set({ status: "waitlisted" })
        .where(eq(teamSeason.id, w.entries[7]!));
      await db
        .update(slot)
        .set({ status: "cancelled" })
        .where(eq(slot.seasonId, w.seasonId));
      const result = await loadSchedulerInput(db, w.seasonId, options);
      expect(
        result.ok && [result.value.teams.length, result.value.slots.length],
      ).toEqual([7, 0]);
      const unknown = await loadSchedulerInput(
        db,
        "00000000-0000-4000-8000-000000000000" as SeasonId,
        options,
      );
      expect(unknown).toEqual({ ok: false, error: "unknown_season" });
    }));
});

describe("saving and publishing versions", () => {
  it("saves a generated season as draft version 1 and loads it back", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const input = (await loadSchedulerInput(db, w.seasonId, options)) as {
        ok: true;
        value: Parameters<typeof generate>[0];
      };
      const schedule = generate(input.value);
      const id = await saveVersion(db, {
        seasonId: w.seasonId,
        input: input.value,
        schedule,
        origin: "generated",
        createdBy: w.adminId,
      });
      const stored = await loadVersion(db, id);
      expect(stored).toMatchObject({ versionNo: 1, status: "draft" });
      expect(stored?.schedule.diagnostics).toEqual(schedule.diagnostics);
      expect(stored?.schedule.games).toEqual(
        [...schedule.games].sort((a, b) => a.key.localeCompare(b.key)),
      );
      expect(
        await db.select().from(game).where(eq(game.seasonId, w.seasonId)),
      ).toHaveLength(28);
    }));

  it("publishes, copies slots to games, and diffs the next version against it", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const loaded = await loadSchedulerInput(db, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const input = loaded.value;
      const first = generate(input);
      const v1 = await saveVersion(db, {
        seasonId: w.seasonId,
        input,
        schedule: first,
        origin: "generated",
      });

      const published = await publishVersion(db, v1, w.adminId);
      expect(published.ok && published.value.added).toHaveLength(28);
      const games = await db
        .select()
        .from(game)
        .where(eq(game.seasonId, w.seasonId));
      expect(games.every((g) => g.slotId !== null)).toBe(true);
      expect(await publishVersion(db, v1, w.adminId)).toEqual({
        ok: false,
        error: "not_draft",
      });

      // Rain on the third Sunday: a new version moves only its games.
      const thirdSunday = input.slots
        .filter((s) => s.date === "2027-04-18")
        .map((s) => s.id);
      const rained = reschedule(input, first, thirdSunday);
      const v2 = await saveVersion(db, {
        seasonId: w.seasonId,
        input,
        schedule: rained.schedule,
        origin: "rainout",
        parentVersionId: v1,
      });
      const second = await publishVersion(db, v2, w.adminId);
      if (!second.ok) throw new Error(second.error);
      expect(second.value.moved.map((m) => m.gameKey).sort()).toEqual(
        rained.moved
          .filter((m) => m.to !== null)
          .map((m) => m.gameKey)
          .sort(),
      );
      expect(second.value.added).toEqual([]);
      const statuses = await db
        .select({
          no: scheduleVersion.versionNo,
          status: scheduleVersion.status,
        })
        .from(scheduleVersion)
        .where(eq(scheduleVersion.seasonId, w.seasonId))
        .orderBy(scheduleVersion.versionNo);
      expect(statuses).toEqual([
        { no: 1, status: "superseded" },
        { no: 2, status: "published" },
      ]);
      // Games keep their rows across versions.
      expect(
        await db.select().from(game).where(eq(game.seasonId, w.seasonId)),
      ).toHaveLength(28);
    }));

  it("keeps makeup rules for edits made after a rain-out", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const loaded = await loadSchedulerInput(db, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const input = loaded.value;
      const first = generate(input);
      const v1 = await saveVersion(db, {
        seasonId: w.seasonId,
        input,
        schedule: first,
        origin: "generated",
      });
      const thirdSunday = input.slots
        .filter((s) => s.date === "2027-04-18")
        .map((s) => s.id);
      const v2 = await saveVersion(db, {
        seasonId: w.seasonId,
        input,
        schedule: reschedule(input, first, thirdSunday).schedule,
        origin: "rainout",
        parentVersionId: v1,
      });
      const rainout = (await loadVersion(db, v2))!;
      expect(rainout.input).toMatchObject({
        gamesPerTeamPerDay: 2,
        reservePerDay: 0,
      });

      // An admin pins one game in place, starting from the rain-out version.
      const [pinned] = rainout.schedule.games.filter((g) => g.slotId !== null);
      const v3 = await saveVersion(db, {
        seasonId: w.seasonId,
        input: {
          ...rainout.input,
          locked: [{ gameKey: pinned!.key, slotId: pinned!.slotId! }],
        },
        schedule: rainout.schedule,
        origin: "manual_edit",
        parentVersionId: v2,
      });
      const [edit] = await db
        .select({ violations: scheduleVersion.violations })
        .from(scheduleVersion)
        .where(eq(scheduleVersion.id, v3));
      expect(edit?.violations).toEqual([]);
      expect((await publishVersion(db, v3, w.adminId)).ok).toBe(true);
    }));

  it("keeps the scheduler's reasons for unplaced games", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await db.insert(teamConstraint).values({
        teamSeasonId: w.entries[0]!,
        kind: "unavailable",
        onDate: "2027-04-04",
      });
      const loaded = await loadSchedulerInput(db, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const schedule = generate(loaded.value);
      expect(schedule.diagnostics.length).toBeGreaterThan(0);
      const id = await saveVersion(db, {
        seasonId: w.seasonId,
        input: loaded.value,
        schedule,
        origin: "generated",
      });
      expect((await loadVersion(db, id))?.schedule.diagnostics).toEqual(
        schedule.diagnostics,
      );
    }));

  it("cannot store two games in one slot", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const loaded = await loadSchedulerInput(db, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const schedule = generate(loaded.value);
      const [a, b] = schedule.games;
      const clash = {
        ...schedule,
        games: schedule.games.map((g) =>
          g === b ? { ...g, slotId: a!.slotId } : g,
        ),
      };
      await expect(
        saveVersion(db, {
          seasonId: w.seasonId,
          input: loaded.value,
          schedule: clash,
          origin: "manual_edit",
        }),
      ).rejects.toThrow();
    }));

  it("refuses to publish a version with violations, or one that does not exist", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const loaded = await loadSchedulerInput(db, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      // A team unavailable on a date it plays: H4.
      const schedule = generate(loaded.value);
      const first = schedule.games[0]!;
      const date = loaded.value.slots.find((s) => s.id === first.slotId)!.date;
      const strict = {
        ...loaded.value,
        constraints: [
          { teamId: first.teamA, kind: "unavailable" as const, date },
        ],
      };
      const bad = await saveVersion(db, {
        seasonId: w.seasonId,
        input: strict,
        schedule,
        origin: "manual_edit",
      });
      expect(await publishVersion(db, bad, w.adminId)).toEqual({
        ok: false,
        error: "has_violations",
      });
      expect(
        await publishVersion(
          db,
          "00000000-0000-4000-8000-000000000000" as Parameters<
            typeof publishVersion
          >[1],
          w.adminId,
        ),
      ).toEqual({ ok: false, error: "unknown_version" });
      expect(
        await loadVersion(
          db,
          required(
            parseId<ScheduleVersionId>("00000000-0000-4000-8000-000000000000"),
            "version id",
          ),
        ),
      ).toBeNull();
    }));
});

describe("audit trail", () => {
  it("records saving and publishing, with who did it", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const loaded = await loadSchedulerInput(db, w.seasonId, options);
      if (!loaded.ok) throw new Error(loaded.error);
      const v1 = await saveVersion(db, {
        seasonId: w.seasonId,
        input: loaded.value,
        schedule: generate(loaded.value),
        origin: "generated",
        createdBy: w.adminId,
      });
      await publishVersion(db, v1, w.adminId);
      const rows = await db
        .select({
          actorId: auditLog.actorId,
          action: auditLog.action,
          after: auditLog.after,
        })
        .from(auditLog)
        .where(eq(auditLog.entityId, v1))
        .orderBy(auditLog.occurredAt, auditLog.action);
      expect(rows).toEqual([
        {
          actorId: w.adminId,
          action: "schedule.publish",
          after: { moved: 0, added: 28, removed: 0, teamsAffected: 8 },
        },
        {
          actorId: w.adminId,
          action: "schedule.save_version",
          after: {
            versionNo: 1,
            origin: "generated",
            violations: 0,
            unplaced: 0,
          },
        },
      ]);
    }));

  it("rejects an action that is not area.verb", () =>
    inRolledBackDb(async (db) => {
      await expect(
        recordAudit(db, {
          actorId: null,
          action: "Publish Schedule",
          entityType: "schedule_version",
          entityId: "00000000-0000-4000-8000-000000000000",
        }),
      ).rejects.toThrow();
    }));
});
