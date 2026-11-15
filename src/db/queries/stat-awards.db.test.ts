import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_MVP_WEIGHTS, winnersOf } from "@/domain/awards/stat-awards";
import type { GameId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { awardPoll, awardVote } from "../schema/awards";
import { sportsmanshipRating } from "../schema/discipline";
import { game, gamePeriod, gameRsvp } from "../schema/game";
import { gameLineup, gameLineupSpot } from "../schema/lineup";
import { profile } from "../schema/profile";
import { leaderboardOptOut } from "../schema/stat-awards";
import { subClaim, subRequest } from "../schema/subs";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import { publicRoster } from "./public-schedule";
import {
  awardsBoard,
  awardsWonBy,
  computeStatAwards,
  gatherSeasons,
  myStatAwards,
  pollWinsBy,
  previewAwards,
  publishedAwardSeasons,
  saveStatAwardNote,
  setLeaderboardOptOut,
  setStatAwardsPublished,
  suggestedNominees,
} from "./stat-awards";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-11-01T12:00:00Z");

/**
 * Aces and Bees play four final games in September. Robin (Aces captain)
 * is in every kicking order; Alex (Aces) says in for three and out for one;
 * Casey (Aces) never answers. The first three games are live scored. Dee
 * (Bees) subs for the Aces once. A closed season MVP poll gives Robin 3
 * votes and Jordan 1.
 */
async function statsWorld(db: Db) {
  const w = await messagingWorld(db);
  const [alex, casey] = w.aces.players as [Player, Player];
  const [dee, sam] = w.bees.players as [Player, Player];
  const named: [Player, string, string][] = [
    [w.aces.captain, "Robin", "Example"],
    [alex, "Alex", "Sample"],
    [casey, "Casey", "Kicker"],
    [w.bees.captain, "Jordan", "Other"],
    [dee, "Dee", "Bee"],
    [sam, "Sam", "Bee"],
  ];
  await db.insert(profile).values(
    named.map(([p, firstName, lastName]) => ({
      userId: p.userId,
      firstName,
      lastName,
    })),
  );
  const games: GameId[] = [];
  for (let i = 0; i < 4; i++) {
    const { gameId } = await w.gameEnding(
      new Date(`2026-09-${String(8 + i * 7).padStart(2, "0")}T23:00:00Z`),
    );
    // Aces win the first three, 6-2; Bees win the last, 5-3.
    const acesWin = i < 3;
    await db
      .update(game)
      .set({
        status: "final",
        scoreA: acesWin ? 6 : 3,
        scoreB: acesWin ? 2 : 5,
        finalizedAt: NOW,
        kicksFirst: i < 3 ? w.aces.id : null,
      })
      .where(eq(game.id, gameId));
    games.push(gameId);
    if (i < 3)
      await db.insert(gamePeriod).values([
        { gameId, periodNo: 1, half: "top", runs: 4 },
        { gameId, periodNo: 1, half: "bottom", runs: 2 },
        { gameId, periodNo: 2, half: "top", runs: 2 },
        { gameId, periodNo: 2, half: "bottom", runs: 0 },
      ]);
    const [lineup] = await db
      .insert(gameLineup)
      .values({ gameId, teamSeasonId: w.aces.id })
      .returning({ id: gameLineup.id });
    await db.insert(gameLineupSpot).values({
      lineupId: lineup!.id,
      position: 1,
      userId: w.aces.captain.userId,
    });
    // The Bees save no orders, so their RSVPs decide.
    await db.insert(gameRsvp).values([
      {
        gameId,
        userId: w.bees.captain.userId,
        teamSeasonId: w.bees.id,
        status: "in",
      },
      { gameId, userId: sam.userId, teamSeasonId: w.bees.id, status: "in" },
      {
        gameId,
        userId: dee.userId,
        teamSeasonId: w.bees.id,
        status: i === 0 ? "out" : "in",
      },
    ]);
    await db.insert(sportsmanshipRating).values({
      gameId,
      teamSeasonId: w.bees.id,
      ratedTeamSeasonId: w.aces.id,
      score: 5,
    });
  }
  // Alex isn't in the Aces' orders, so the orders say Alex missed every game.
  const [request] = await db
    .insert(subRequest)
    .values({
      gameId: games[3]!,
      teamSeasonId: w.aces.id,
      needed: 1,
      status: "filled",
      closesAt: NOW,
    })
    .returning({ id: subRequest.id });
  await db.insert(subClaim).values({
    subRequestId: request!.id,
    userId: dee.userId,
    status: "approved",
  });
  const [poll] = await db
    .insert(awardPoll)
    .values({
      seasonId: w.season.id,
      kind: "season",
      category: "mvp",
      title: "Fall MVP",
      opensAt: new Date("2026-10-01T00:00:00Z"),
      closesAt: new Date("2026-10-10T00:00:00Z"),
    })
    .returning({ id: awardPoll.id });
  await db.insert(awardVote).values([
    ...[alex, casey, dee].map((v) => ({
      awardPollId: poll!.id,
      voterId: v.userId,
      nomineeUserId: w.aces.captain.userId,
    })),
    {
      awardPollId: poll!.id,
      voterId: w.aces.captain.userId,
      nomineeUserId: w.bees.captain.userId,
    },
  ]);
  return { w, games, alex, casey, dee, sam, pollId: poll!.id };
}

const ADMIN = (w: { aces: { captain: Player } }) => w.aces.captain.userId;

describe("gatherSeasons", () => {
  it("reads attendance from orders, then RSVPs, and runs from live scores", async () => {
    await inRolledBackDb(async (db) => {
      const { w, alex, casey, dee } = await statsWorld(db);
      const { seasons, roster } = await gatherSeasons(db, [w.season.id]);
      const of = (p: Player) => seasons.get(`${w.season.id}|${p.userId}`)!;
      expect(roster.map((r) => r.name).sort()).toContain("Robin E.");

      const robin = of(w.aces.captain);
      expect(robin.games.map((g) => g.attendance)).toEqual([
        "played",
        "played",
        "played",
        "played",
      ]);
      expect(robin.games.map((g) => g.won)).toEqual([true, true, true, false]);
      // The Aces kick first: 4 + 2 runs in the top halves.
      expect(robin.games.map((g) => g.liveRuns)).toEqual([6, 6, 6, null]);
      expect(robin.games.map((g) => g.rating)).toEqual([5, 5, 5, 5]);
      expect(robin.mvpVotes).toBe(3);
      expect(robin.firstSeason).toBe(true);

      expect(of(alex).games.every((g) => g.attendance === "missed")).toBe(true);
      expect(of(casey).games.every((g) => g.attendance === "missed")).toBe(
        true,
      );
      const deeGames = of(dee);
      expect(deeGames.games.map((g) => g.attendance)).toEqual([
        "missed",
        "played",
        "played",
        "played",
      ]);
      // The Bees kick second: 2 + 0 in the bottom halves.
      expect(deeGames.games.map((g) => g.liveRuns)).toEqual([2, 2, 2, null]);
      expect(deeGames.subAppearances).toBe(1);
    });
  });

  it("reads one person's seasons only when asked", async () => {
    await inRolledBackDb(async (db) => {
      const { w, dee } = await statsWorld(db);
      const { roster, seasons } = await gatherSeasons(db, [w.season.id], {
        userId: dee.userId,
      });
      expect(roster.map((r) => r.userId)).toEqual([dee.userId]);
      expect(seasons.size).toBe(1);
    });
  });
});

describe("computing and publishing", () => {
  it("saves the winners, ties shared, and shows them only once published", async () => {
    await inRolledBackDb(async (db) => {
      const { w, dee, sam } = await statsWorld(db);
      const computed = await computeStatAwards(db, {
        seasonId: w.season.id,
        weights: DEFAULT_MVP_WEIGHTS,
        actorId: ADMIN(w),
        now: NOW,
      });
      expect(computed.ok).toBe(true);
      if (!computed.ok) return;
      const r = computed.value;
      expect(winnersOf(r.leaders.season_mvp)).toEqual([w.aces.captain.userId]);
      expect(winnersOf(r.leaders.golden_boot)).toEqual([w.aces.captain.userId]);
      expect(winnersOf(r.leaders.sub_of_the_year)).toEqual([dee.userId]);
      // Jordan and Sam both went 4 for 4; Robin too.
      expect(winnersOf(r.leaders.iron_kicker).sort()).toEqual(
        [w.aces.captain.userId, w.bees.captain.userId, sam.userId].sort(),
      );

      // A draft: admins see it, the public page doesn't.
      const draft = await awardsBoard(
        db,
        { seasonId: w.season.id },
        { publishedOnly: false },
      );
      expect(draft.found && draft.board?.places.length).toBeGreaterThan(0);
      const hidden = await awardsBoard(
        db,
        { leagueId: w.leagueId, seasonSlug: w.season.slug },
        { publishedOnly: true },
      );
      expect(hidden).toEqual({
        found: true,
        seasonId: w.season.id,
        board: null,
      });
      expect(await awardsWonBy(db, w.aces.captain.userId)).toEqual([]);

      expect(
        (
          await setStatAwardsPublished(db, {
            seasonId: w.season.id,
            publish: true,
            actorId: ADMIN(w),
            now: NOW,
          })
        ).ok,
      ).toBe(true);
      const shown = await awardsBoard(
        db,
        { leagueId: w.leagueId, seasonSlug: w.season.slug },
        { publishedOnly: true },
      );
      const board = shown.found ? shown.board : null;
      expect(board?.publishedAt).toEqual(NOW);
      const mvp = board?.places.find(
        (p) => p.award === "season_mvp" && p.place === 1,
      );
      expect(mvp).toMatchObject({ name: "Robin E.", teamName: "Aces" });
      expect(mvp?.detail).toMatchObject({ recorded: 4, of: 4 });
      expect(
        (await awardsWonBy(db, w.aces.captain.userId)).map((a) => a.award),
      ).toEqual(
        expect.arrayContaining(["season_mvp", "golden_boot", "iron_kicker"]),
      );
      expect(
        (await publishedAwardSeasons(db, w.leagueId)).map((s) => s.slug),
      ).toContain(w.season.slug);

      // The team page's roster carries the badges.
      const roster = await publicRoster(db, w.aces.id);
      expect(roster.find((p) => p.name === "Robin E.")?.awards).toEqual(
        expect.arrayContaining(["season_mvp", "golden_boot"]),
      );
      expect(roster.find((p) => p.name === "Alex S.")?.awards).toEqual([]);

      const audit = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, w.season.id));
      expect(audit.map((a) => a.action).sort()).toEqual([
        "stat_awards.compute",
        "stat_awards.publish",
      ]);
    });
  });

  it("won't recompute a published set until it's taken down", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await statsWorld(db);
      const input = {
        seasonId: w.season.id,
        weights: DEFAULT_MVP_WEIGHTS,
        actorId: ADMIN(w),
        now: NOW,
      };
      await computeStatAwards(db, input);
      await setStatAwardsPublished(db, { ...input, publish: true });
      const again = await computeStatAwards(db, input);
      expect(again).toEqual({ ok: false, error: "published" });
      await setStatAwardsPublished(db, { ...input, publish: false });
      const weights = { runs: 0, wins: 0, attendance: 0, votes: 1 };
      const redone = await computeStatAwards(db, { ...input, weights });
      expect(redone.ok).toBe(true);
      const board = await awardsBoard(
        db,
        { seasonId: w.season.id },
        { publishedOnly: false },
      );
      expect(board.found && board.board?.weights).toEqual(weights);
      expect(board.found && board.board?.publishedAt).toBeNull();
    });
  });

  it("keeps notes across a recompute and clears an empty one", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await statsWorld(db);
      const base = { seasonId: w.season.id, actorId: ADMIN(w) };
      expect(
        await saveStatAwardNote(db, {
          ...base,
          award: "season_mvp",
          note: "Hi",
        }),
      ).toEqual({ ok: false, error: "not_computed" });
      const compute = () =>
        computeStatAwards(db, {
          ...base,
          weights: DEFAULT_MVP_WEIGHTS,
          now: NOW,
        });
      await compute();
      await saveStatAwardNote(db, {
        ...base,
        award: "season_mvp",
        note: "A runaway season.",
      });
      await saveStatAwardNote(db, {
        ...base,
        award: "iron_kicker",
        note: "Three perfect records.",
      });
      await compute();
      await saveStatAwardNote(db, {
        ...base,
        award: "iron_kicker",
        note: null,
      });
      const board = await awardsBoard(
        db,
        { seasonId: w.season.id },
        { publishedOnly: false },
      );
      expect(board.found && board.board?.notes).toEqual({
        season_mvp: "A runaway season.",
      });
    });
  });
});

describe("leaderboard opt-out", () => {
  it("leaves an opted-out player off the computation and the pages", async () => {
    await inRolledBackDb(async (db) => {
      const { w, pollId } = await statsWorld(db);
      const input = {
        seasonId: w.season.id,
        weights: DEFAULT_MVP_WEIGHTS,
        actorId: ADMIN(w),
        now: NOW,
      };
      await computeStatAwards(db, input);
      await setStatAwardsPublished(db, { ...input, publish: true });

      // Opting out after publishing hides them at once.
      const seasons = await setLeaderboardOptOut(
        db,
        w.aces.captain.userId,
        true,
      );
      expect(seasons).toEqual([w.season.id]);
      const board = await awardsBoard(
        db,
        { leagueId: w.leagueId, seasonSlug: w.season.slug },
        { publishedOnly: true },
      );
      expect(
        board.found &&
          board.board?.places.some((p) => p.userId === w.aces.captain.userId),
      ).toBe(false);
      expect(
        (await publicRoster(db, w.aces.id)).find((p) => p.name === "Robin E.")
          ?.awards,
      ).toEqual([]);
      const suggestions = await suggestedNominees(db, [
        { id: pollId, seasonId: w.season.id, kind: "season", category: "mvp" },
      ]);
      expect(suggestions.get(pollId)).not.toContain(w.aces.captain.userId);

      // Computing again leaves them out entirely.
      const preview = await previewAwards(db, w.season.id, DEFAULT_MVP_WEIGHTS);
      expect(preview.hidden).toBe(1);
      expect(
        preview.result.stats.some((s) => s.userId === w.aces.captain.userId),
      ).toBe(false);

      // Opting back in is idempotent and shows them again.
      await setLeaderboardOptOut(db, w.aces.captain.userId, false);
      await setLeaderboardOptOut(db, w.aces.captain.userId, false);
      expect(
        await db
          .select()
          .from(leaderboardOptOut)
          .where(eq(leaderboardOptOut.userId, w.aces.captain.userId)),
      ).toEqual([]);
    });
  });

  it("removes a deleted account's places and opt-out", async () => {
    await inRolledBackDb(async (db) => {
      const { w, sam } = await statsWorld(db);
      await computeStatAwards(db, {
        seasonId: w.season.id,
        weights: DEFAULT_MVP_WEIGHTS,
        actorId: ADMIN(w),
        now: NOW,
      });
      expect(
        (await myStatAwards(db, sam.userId)).statAwardPlaces.length,
      ).toBeGreaterThan(0);
      await setLeaderboardOptOut(db, sam.userId, true);
      expect((await deleteAccount(db, sam.userId, NOW)).ok).toBe(true);
      const data = await myStatAwards(db, sam.userId);
      expect(data).toEqual({ statAwardPlaces: [], offLeaderboards: false });
    });
  });

  it("lists the opt-out and award places in the person's own export", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await statsWorld(db);
      await computeStatAwards(db, {
        seasonId: w.season.id,
        weights: DEFAULT_MVP_WEIGHTS,
        actorId: ADMIN(w),
        now: NOW,
      });
      await setLeaderboardOptOut(db, w.bees.captain.userId, true);
      const robin = await personalData(db, w.aces.captain.userId, NOW);
      expect(robin?.offLeaderboards).toBe(false);
      expect(robin?.statAwardPlaces.map((p) => p.award)).toContain(
        "season_mvp",
      );
      const jordan = await personalData(db, w.bees.captain.userId, NOW);
      expect(jordan?.offLeaderboards).toBe(true);
    });
  });
});

describe("suggestions and poll wins", () => {
  it("suggests the MVP leaders for a season MVP poll only", async () => {
    await inRolledBackDb(async (db) => {
      const { w, pollId } = await statsWorld(db);
      await computeStatAwards(db, {
        seasonId: w.season.id,
        weights: DEFAULT_MVP_WEIGHTS,
        actorId: ADMIN(w),
        now: NOW,
      });
      const got = await suggestedNominees(db, [
        { id: pollId, seasonId: w.season.id, kind: "season", category: "mvp" },
        {
          id: "weekly",
          seasonId: w.season.id,
          kind: "weekly",
          category: "mvp",
        },
        {
          id: "teams",
          seasonId: w.season.id,
          kind: "season",
          category: "best_dressed",
        },
      ]);
      expect(got.get(pollId)?.[0]).toBe(w.aces.captain.userId);
      expect(got.has("weekly")).toBe(false);
      expect(got.has("teams")).toBe(false);
    });
  });

  it("counts a closed poll the person topped", async () => {
    await inRolledBackDb(async (db) => {
      const { w } = await statsWorld(db);
      expect(
        (await pollWinsBy(db, w.aces.captain.userId)).get(w.season.id),
      ).toBe(1);
      expect((await pollWinsBy(db, w.bees.captain.userId)).size).toBe(0);
    });
  });
});
