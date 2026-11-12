import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId } from "@/domain/ids";
import { generate } from "@/domain/scheduler/generate";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { bracket, bracketMatch } from "../schema/playoffs";
import { scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  advanceBracket,
  bracketView,
  createBracket,
  playoffPreview,
  publishBracket,
} from "./playoffs";
import { required } from "./rows";
import {
  type Db,
  loadSchedulerInput,
  loadVersion,
  publishVersion,
  saveVersion,
} from "./schedule";
import { reportScore } from "./scores";
import { seasonStandings } from "./standings";

afterAll(closePool);

const PLAYOFF_DAY = "2027-04-25";
const AFTER = new Date("2027-04-26T12:00:00Z");

/**
 * A season with `n` teams, two fields and four times on three Sundays. The
 * first Sunday's round is played and published; the last is free for the
 * playoffs.
 */
async function world(db: Db, n = 8) {
  const tag = Math.random().toString(36).slice(2, 8);
  const [admin] = await db
    .insert(user)
    .values({ name: "Admin", email: `playoffs-${tag}@example.test` })
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
      slug: `spring-${tag}`,
      status: "in_progress",
      startsOn: "2027-04-04",
      endsOn: PLAYOFF_DAY,
      feeModel: "per_team",
      teamFeeCents: 120000,
      rosterMin: 12,
      rosterMax: 20,
    })
    .returning({ id: season.id });
  const seasonId = sn!.id;
  const [vn] = await db
    .insert(venue)
    .values({ leagueId: lg!.id, name: "Test Park", slug: `park-${tag}` })
    .returning({ id: venue.id });
  const fields = await db
    .insert(field)
    .values([1, 2].map((k) => ({ venueId: vn!.id, name: `Field ${k}` })))
    .returning({ id: field.id });
  // 10:00, 11:30, 1:00 and 2:30 New York time (EDT, UTC-4).
  const starts = ["14:00", "15:30", "17:00", "18:30"];
  await db.insert(slot).values(
    ["2027-04-04", "2027-04-11", PLAYOFF_DAY].flatMap((date) =>
      starts.flatMap((time, timeIndex) =>
        fields.map((f) => {
          const startsAt = new Date(`${date}T${time}:00Z`);
          return {
            seasonId,
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
      Array.from({ length: n }, (_, i) => ({
        leagueId: lg!.id,
        name: `Team ${i + 1}`,
        slug: `team-${i + 1}-${tag}`,
      })),
    )
    .returning({ id: team.id });
  await db.insert(teamSeason).values(
    teams.map((t) => ({
      teamId: t.id,
      seasonId,
      status: "confirmed" as const,
    })),
  );

  // One regular round on the first Sunday, published and played.
  const input = await loadSchedulerInput(db, seasonId, {
    rounds: 1,
    reservePerDay: 0,
    seed: 3,
  });
  if (!input.ok) throw new Error(input.error);
  const regularSlots = input.value.slots.filter((s) => s.date === "2027-04-04");
  const versionId = await saveVersion(db, {
    seasonId,
    input: { ...input.value, slots: regularSlots },
    schedule: generate({ ...input.value, slots: regularSlots }),
    origin: "generated",
  });
  const published = await publishVersion(db, versionId, admin!.id);
  if (!published.ok) throw new Error(published.error);
  const regular = await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.seasonId, seasonId))
    .orderBy(game.id);
  for (const [i, g] of regular.entries())
    await db
      .update(game)
      .set({
        status: "final",
        scoreA: 10 + i,
        scoreB: i,
        finalizedAt: new Date("2027-04-04T20:00:00Z"),
      })
      .where(eq(game.id, g.id));
  return { adminId: admin!.id, seasonId };
}

type World = Awaited<ReturnType<typeof world>>;

async function makeBracket(db: Db, w: World, teams = 8) {
  const created = await createBracket(db, {
    seasonId: w.seasonId,
    teams,
    fromDate: PLAYOFF_DAY,
    actorId: w.adminId,
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

async function matches(db: Db, w: World) {
  const view = required(
    await bracketView(db, w.seasonId, { includeDraft: true }),
    "bracket",
  );
  return new Map(view.matches.map((m) => [m.code, m]));
}

let reported = 0;

/**
 * An admin's score, final at once. Each report is a minute after the last,
 * so a correction is always the latest report, as it is at the field.
 */
async function play(
  db: Db,
  w: World,
  gameId: GameId | null,
  scoreA: number,
  scoreB: number,
) {
  const result = await reportScore(db, {
    gameId: required(gameId, "game"),
    userId: w.adminId,
    role: "admin",
    teamSeasonId: null,
    score: { outcome: "normal", scoreA, scoreB, inningsPlayed: null },
    clientId: `${gameId}-${scoreA}-${scoreB}-${Math.random()}`,
    now: new Date(AFTER.getTime() + ++reported * 60_000),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function publishedVersion(db: Db, w: World) {
  const [found] = await db
    .select({ id: scheduleVersion.id, origin: scheduleVersion.origin })
    .from(scheduleVersion)
    .where(
      and(
        eq(scheduleVersion.seasonId, w.seasonId),
        eq(scheduleVersion.status, "published"),
      ),
    );
  return required(found, "published version");
}

describe("seeding and saving a bracket", () => {
  it("seeds from the standings and saves a draft playoffs version", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      const preview = required(await playoffPreview(db, w.seasonId), "preview");
      expect(preview).toMatchObject({
        eligibleCount: 8,
        defaultTeams: 8,
        hasPublishedSchedule: true,
        // The second Sunday is unused, but only dates after the last
        // regular game are offered.
        dates: [
          { date: "2027-04-11", free: 8 },
          { date: PLAYOFF_DAY, free: 8 },
        ],
      });

      const bracketId = await makeBracket(db, w);
      const [saved] = await db
        .select()
        .from(bracket)
        .where(eq(bracket.id, bracketId));
      const { rows } = await seasonStandings(db, w.seasonId);
      expect(saved!.seeds.map((s) => s.teamSeasonId)).toEqual(
        rows.map((r) => r.teamId),
      );
      expect(saved!.status).toBe("draft");
      const seeded = await db
        .select({ id: teamSeason.id, seed: teamSeason.seed })
        .from(teamSeason)
        .where(eq(teamSeason.seasonId, w.seasonId));
      expect(seeded.sort((a, b) => a.seed! - b.seed!).map((s) => s.id)).toEqual(
        rows.map((r) => r.teamId),
      );

      // Seven matches on the playoff day; the quarterfinals have games.
      const byCode = await matches(db, w);
      expect(byCode.size).toBe(7);
      expect([...byCode.values()].filter((m) => m.gameId)).toHaveLength(4);
      expect(
        [...byCode.values()].every((m) =>
          m.startsAt?.toISOString().startsWith(PLAYOFF_DAY),
        ),
      ).toBe(true);
      const kinds = await db
        .select({ kind: slot.kind })
        .from(slot)
        .innerJoin(bracketMatch, eq(bracketMatch.slotId, slot.id));
      expect(kinds.every((k) => k.kind === "playoff")).toBe(true);

      // The draft keeps the regular season and adds the four games.
      const draft = required(
        await loadVersion(db, saved!.scheduleVersionId!),
        "draft",
      );
      const before = await publishedVersion(db, w);
      const regular = required(await loadVersion(db, before.id), "published");
      expect(draft.status).toBe("draft");
      expect(draft.schedule.games).toEqual(regular.schedule.games);
      expect(draft.playoffs).toHaveLength(4);
      const [row] = await db
        .select()
        .from(scheduleVersion)
        .where(eq(scheduleVersion.id, draft.id));
      expect(row).toMatchObject({
        origin: "playoffs",
        parentVersionId: before.id,
        violations: [],
      });
    }));

  it("replaces a draft bracket, and refuses bad sizes, dates and repeats", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await makeBracket(db, w, 8);
      await makeBracket(db, w, 4);
      const games = await db
        .select({ id: game.id })
        .from(game)
        .where(and(eq(game.seasonId, w.seasonId), eq(game.kind, "playoff")));
      expect(games).toHaveLength(2);
      const drafts = await db
        .select({ id: scheduleVersion.id })
        .from(scheduleVersion)
        .where(
          and(
            eq(scheduleVersion.seasonId, w.seasonId),
            eq(scheduleVersion.origin, "playoffs"),
          ),
        );
      expect(drafts).toHaveLength(1);

      const attempt = (teams: number, fromDate = PLAYOFF_DAY) =>
        createBracket(db, {
          seasonId: w.seasonId,
          teams,
          fromDate,
          actorId: w.adminId,
        });
      expect(await attempt(1)).toEqual({ ok: false, error: "too_few_teams" });
      expect(await attempt(9)).toEqual({ ok: false, error: "too_few_teams" });
      expect(await attempt(8, "2027-06-01")).toEqual({
        ok: false,
        error: "no_slots",
      });
      expect(await publishBracket(db, w.seasonId, w.adminId)).toMatchObject({
        ok: true,
      });
      expect(await attempt(8)).toEqual({
        ok: false,
        error: "already_published",
      });
    }));

  it("publishes like the regular season and starts the playoffs", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await makeBracket(db, w);
      expect(await bracketView(db, w.seasonId)).toBeNull();
      expect(await publishBracket(db, w.seasonId, w.adminId)).toMatchObject({
        ok: true,
      });
      const [sn] = await db
        .select({ status: season.status })
        .from(season)
        .where(eq(season.id, w.seasonId));
      expect(sn!.status).toBe("playoffs");
      const placed = await db
        .select({ slotId: game.slotId })
        .from(game)
        .where(and(eq(game.seasonId, w.seasonId), eq(game.kind, "playoff")));
      expect(placed.every((g) => g.slotId !== null)).toBe(true);
      expect((await bracketView(db, w.seasonId))?.status).toBe("published");
      expect(await publishBracket(db, w.seasonId, w.adminId)).toEqual({
        ok: false,
        error: "already_published",
      });
    }));

  it("refuses a stale draft after another version was published", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await makeBracket(db, w);
      const current = required(
        await loadVersion(db, (await publishedVersion(db, w)).id),
        "published",
      );
      const edit = await saveVersion(db, {
        seasonId: w.seasonId,
        input: current.input,
        schedule: current.schedule,
        origin: "manual_edit",
        parentVersionId: current.id,
      });
      expect(await publishVersion(db, edit, w.adminId)).toMatchObject({
        ok: true,
      });
      expect(await publishBracket(db, w.seasonId, w.adminId)).toEqual({
        ok: false,
        error: "stale",
      });
    }));

  it("keeps the bracket when the regular season is edited later", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await makeBracket(db, w);
      await publishBracket(db, w.seasonId, w.adminId);
      const current = required(
        await loadVersion(db, (await publishedVersion(db, w)).id),
        "published",
      );
      expect(current.playoffs).toHaveLength(4);
      const edit = await saveVersion(db, {
        seasonId: w.seasonId,
        input: current.input,
        schedule: current.schedule,
        origin: "manual_edit",
        parentVersionId: current.id,
      });
      await publishVersion(db, edit, w.adminId);
      const after = required(await loadVersion(db, edit), "edit");
      expect(after.playoffs).toEqual(current.playoffs);
      const placed = await db
        .select({ slotId: game.slotId })
        .from(game)
        .where(and(eq(game.seasonId, w.seasonId), eq(game.kind, "playoff")));
      expect(placed.every((g) => g.slotId !== null)).toBe(true);
    }));
});

describe("advancing winners", () => {
  it("schedules each next game as results become final, to a champion", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db);
      await makeBracket(db, w);
      await publishBracket(db, w.seasonId, w.adminId);
      let m = await matches(db, w);

      // A playoff game cannot end in a tie.
      const tie = await reportScore(db, {
        gameId: m.get("r1m1")!.gameId!,
        userId: w.adminId,
        role: "admin",
        teamSeasonId: null,
        score: { outcome: "normal", scoreA: 3, scoreB: 3, inningsPlayed: null },
        clientId: "tie",
        now: AFTER,
      });
      expect(tie.ok).toBe(false);

      // One quarterfinal: the winner waits in the semifinal.
      await play(db, w, m.get("r1m1")!.gameId, 2, 5);
      m = await matches(db, w);
      const qf1 = m.get("r1m1")!;
      expect(qf1.winnerId).toBe(qf1.teamB!.id);
      expect(m.get("r2m1")!.teamA?.id).toBe(qf1.teamB!.id);
      expect(m.get("r2m1")!.gameId).toBeNull();

      // The second quarterfinal fills the semifinal, which is published in
      // its reserved slot by a new playoffs version.
      const versionsBefore = (await publishedVersion(db, w)).id;
      await play(db, w, m.get("r1m2")!.gameId, 7, 1);
      m = await matches(db, w);
      const semi = m.get("r2m1")!;
      expect(semi.gameId).not.toBeNull();
      const after = await publishedVersion(db, w);
      expect(after.id).not.toBe(versionsBefore);
      expect(after.origin).toBe("playoffs");
      const [semiGame] = await db
        .select()
        .from(game)
        .where(eq(game.id, semi.gameId!));
      const [reserved] = await db
        .select({ slotId: bracketMatch.slotId })
        .from(bracketMatch)
        .innerJoin(bracket, eq(bracketMatch.bracketId, bracket.id))
        .where(
          and(eq(bracketMatch.code, "r2m1"), eq(bracket.seasonId, w.seasonId)),
        );
      expect(semiGame).toMatchObject({
        kind: "playoff",
        teamAId: qf1.teamB!.id,
        teamBId: m.get("r1m2")!.teamA!.id,
        slotId: reserved!.slotId,
      });

      // Settling the same result again changes nothing.
      expect(await advanceBracket(db, m.get("r1m2")!.gameId!, AFTER)).toEqual({
        kind: "unchanged",
      });

      await play(db, w, m.get("r1m3")!.gameId, 1, 0);
      await play(db, w, m.get("r1m4")!.gameId, 0, 1);
      m = await matches(db, w);
      await play(db, w, m.get("r2m1")!.gameId, 4, 3);
      await play(db, w, m.get("r2m2")!.gameId, 4, 6);
      m = await matches(db, w);
      const final = m.get("r3m1")!;
      expect(final.gameId).not.toBeNull();
      await play(db, w, final.gameId, 9, 8);
      const view = required(await bracketView(db, w.seasonId), "bracket");
      expect(view.status).toBe("complete");
      expect(view.champion?.id).toBe(final.teamA!.id);
    }));

  it("moves bye teams on and corrects a result before the next game", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, 6);
      await makeBracket(db, w, 6);
      await publishBracket(db, w.seasonId, w.adminId);
      let m = await matches(db, w);
      // Seeds 1 and 2 have byes; two first-round games are played.
      expect([...m.values()].filter((x) => x.gameId)).toHaveLength(2);
      expect(m.get("r2m1")!.teamA?.seed).toBe(1);
      expect(m.get("r2m2")!.teamA?.seed).toBe(2);

      const first = m.get("r1m2")!;
      await play(db, w, first.gameId, 6, 2);
      m = await matches(db, w);
      const semi = m.get("r2m1")!;
      expect(semi.teamB?.id).toBe(first.teamA!.id);
      expect(semi.gameId).not.toBeNull();

      // An admin corrects the score: the other team plays the semifinal.
      await play(db, w, first.gameId, 2, 6);
      m = await matches(db, w);
      expect(m.get("r2m1")!.teamB?.id).toBe(first.teamB!.id);
      const [semiGame] = await db
        .select({ teamBId: game.teamBId })
        .from(game)
        .where(eq(game.id, semi.gameId!));
      expect(semiGame!.teamBId).toBe(first.teamB!.id);
    }));

  it("ignores games outside a bracket", () =>
    inRolledBackDb(async (db) => {
      const w = await world(db, 4);
      const [regular] = await db
        .select({ id: game.id })
        .from(game)
        .where(eq(game.seasonId, w.seasonId));
      expect(await advanceBracket(db, regular!.id, AFTER)).toEqual({
        kind: "not_playoff",
      });
      expect(
        await bracketView(db, w.seasonId, { includeDraft: true }),
      ).toBeNull();
    }));
});
