import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { GameId, TeamSeasonId } from "@/domain/ids";
import { auditLog } from "../schema/audit";
import { awardPoll, awardVote } from "../schema/awards";
import { game, gamePeriod, gameRsvp } from "../schema/game";
import { gameLineup, gameLineupSpot } from "../schema/lineup";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { seasonCard } from "../schema/season-card";
import { messagingWorld, type Player } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import type { Db } from "./schedule";
import {
  buildSeasonCards,
  myCard,
  myCards,
  publicCard,
  publicCardIds,
  seasonCardSummary,
  setCardPublic,
} from "./season-cards";

afterAll(closePool);

const NOW = new Date("2026-11-14T16:00:00Z");

/**
 * The messaging world played out: Aces beat Bees 7-3 (scored live), won
 * a forfeit, then lost 2-5. Alex said they were in for the first game
 * only; Casey kicked in the last one; Robin, the captain, never answered.
 * Alex won the season MVP poll.
 */
async function playedWorld(db: Db) {
  const w = await messagingWorld(db);
  const named: [Player, string, string][] = [
    [w.aces.captain, "Robin", "Example"],
    [w.aces.players[0]!, "Alex", "Sample"],
    [w.aces.players[1]!, "Casey", "Kicker"],
    [w.bees.captain, "Jordan", "Other"],
    [w.bees.players[0]!, "Dee", "Bee"],
    [w.bees.players[1]!, "Sam", "Bee"],
  ];
  await db.insert(profile).values(
    named.map(([p, firstName, lastName]) => ({
      userId: p.userId,
      firstName,
      lastName,
    })),
  );
  const [robin, alex, casey] = [
    w.aces.captain,
    w.aces.players[0]!,
    w.aces.players[1]!,
  ];

  const played = async (
    endsAt: string,
    result: { a: number; b: number } | { forfeitBy: TeamSeasonId },
  ): Promise<GameId> => {
    const { gameId } = await w.gameEnding(new Date(endsAt));
    await db
      .update(game)
      .set(
        "forfeitBy" in result
          ? {
              status: "forfeit",
              forfeitBy: result.forfeitBy,
              finalizedAt: new Date(endsAt),
            }
          : {
              status: "final",
              scoreA: result.a,
              scoreB: result.b,
              finalizedAt: new Date(endsAt),
            },
      )
      .where(eq(game.id, gameId));
    return gameId;
  };
  const first = await played("2026-09-14T20:00:00Z", { a: 7, b: 3 });
  const second = await played("2026-09-21T20:00:00Z", {
    forfeitBy: w.bees.id,
  });
  const third = await played("2026-09-28T20:00:00Z", { a: 2, b: 5 });

  // The first game, scored live with Aces kicking first.
  await db
    .update(game)
    .set({ kicksFirst: w.aces.id })
    .where(eq(game.id, first));
  await db.insert(gamePeriod).values(
    [
      ["top", [1, 5, 1]],
      ["bottom", [0, 3, 0]],
    ].flatMap(([half, runs]) =>
      (runs as number[]).map((r, i) => ({
        gameId: first,
        periodNo: i + 1,
        half: half as "top" | "bottom",
        runs: r,
      })),
    ),
  );

  await db.insert(gameRsvp).values([
    {
      gameId: first,
      userId: alex.userId,
      teamSeasonId: w.aces.id,
      status: "in",
    },
    {
      gameId: third,
      userId: alex.userId,
      teamSeasonId: w.aces.id,
      status: "out",
    },
  ]);
  const [lineup] = await db
    .insert(gameLineup)
    .values({ gameId: third, teamSeasonId: w.aces.id })
    .returning({ id: gameLineup.id });
  await db
    .insert(gameLineupSpot)
    .values({ lineupId: lineup!.id, position: 1, userId: casey.userId });

  const [poll] = await db
    .insert(awardPoll)
    .values({
      seasonId: w.season.id,
      kind: "season",
      category: "mvp",
      title: "Fall 2026 MVP",
      opensAt: new Date("2026-10-01T00:00:00Z"),
      closesAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning({ id: awardPoll.id });
  await db.insert(awardVote).values([
    {
      awardPollId: poll!.id,
      voterId: robin.userId,
      nomineeUserId: alex.userId,
    },
    {
      awardPollId: poll!.id,
      voterId: w.bees.captain.userId,
      nomineeUserId: alex.userId,
    },
    {
      awardPollId: poll!.id,
      voterId: alex.userId,
      nomineeUserId: robin.userId,
    },
  ]);

  const complete = () =>
    db
      .update(season)
      .set({ status: "completed" })
      .where(eq(season.id, w.season.id));
  const build = () =>
    buildSeasonCards(db, {
      seasonId: w.season.id,
      actorId: robin.userId,
      now: NOW,
    });
  return {
    ...w,
    robin,
    alex,
    casey,
    games: { first, second, third },
    complete,
    build,
  };
}

describe("buildSeasonCards", () => {
  it("waits for the season to be completed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      const result = await w.build();
      expect(result).toEqual({ ok: false, error: "not_completed" });
      expect(await db.select().from(seasonCard)).toEqual([]);
    });
  });

  it("gives every rostered player their own season", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      await w.complete();
      const result = await w.build();
      expect(result).toEqual({
        ok: true,
        value: { cards: 6, told: 6, slug: w.season.slug },
      });

      const alex = await myCard(db, w.alex.userId, w.season.slug);
      expect(alex?.isPublic).toBe(false);
      expect(alex?.stats).toMatchObject({
        playerName: "Alex S.",
        seasonName: "Fall 2026",
        team: { name: "Aces" },
        gamesPlayed: 3,
        attended: 1,
        runs: 7,
        liveGames: 1,
        biggestInning: { runs: 5, opponent: "Bees", day: "2026-09-14" },
        record: { wins: 2, losses: 1, ties: 0 },
        finish: { rank: 1, of: 2, champion: true },
        awardsWon: [{ title: "Fall 2026 MVP", team: false }],
        votesCast: 1,
        longestWinStreak: 1,
        bestGame: {
          opponent: "Bees",
          runsFor: 7,
          runsAgainst: 3,
          outcome: "W",
        },
      });

      // Robin never answered an RSVP: every team game counts as theirs.
      const robin = await myCard(db, w.robin.userId, w.season.slug);
      expect(robin?.stats).toMatchObject({
        attended: null,
        runs: 9,
        longestWinStreak: 2,
        awardsWon: [],
        votesCast: 1,
      });

      // Casey kicked in the loss only.
      const casey = await myCard(db, w.casey.userId, w.season.slug);
      expect(casey?.stats).toMatchObject({
        attended: 1,
        runs: 2,
        longestWinStreak: 0,
        liveGames: 0,
        biggestInning: null,
        bestGame: { runsFor: 2, runsAgainst: 5, outcome: "L" },
      });

      const bees = await myCard(db, w.bees.captain.userId, w.season.slug);
      expect(bees?.stats).toMatchObject({
        team: { name: "Bees" },
        record: { wins: 1, losses: 2, ties: 0 },
        finish: { rank: 2, of: 2, champion: false },
        // Bees kicked second in the live game: their halves were 0, 3, 0.
        biggestInning: { runs: 3, opponent: "Aces" },
      });
    });
  });

  it("names no other player on a card", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      await w.complete();
      await w.build();
      const alex = await myCard(db, w.alex.userId, w.season.slug);
      const text = JSON.stringify(alex?.stats);
      for (const other of ["Robin", "Casey", "Jordan", "Dee", "Sam", "@"])
        expect(text).not.toContain(other);
    });
  });

  it("tells each player once, and a refresh keeps their sharing choice", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      await w.complete();
      await w.build();
      const sent = await db
        .select({
          userId: message.userId,
          template: message.template,
          topic: message.topic,
          dedupeKey: message.dedupeKey,
          payload: message.payload,
        })
        .from(message)
        .where(eq(message.template, "season_card"));
      expect(sent).toHaveLength(6);
      expect(sent.find((m) => m.userId === w.alex.userId)).toEqual({
        userId: w.alex.userId,
        template: "season_card",
        topic: "announcement",
        dedupeKey: `season_card/${w.season.id}/${w.alex.userId}`,
        payload: { seasonName: "Fall 2026", seasonSlug: w.season.slug },
      });

      await setCardPublic(db, {
        userId: w.alex.userId,
        seasonSlug: w.season.slug,
        isPublic: true,
      });
      // A late correction: the loss was 4-5.
      await db
        .update(game)
        .set({ scoreA: 4 })
        .where(eq(game.id, w.games.third));
      const again = await w.build();
      expect(again).toEqual({
        ok: true,
        value: { cards: 6, told: 0, slug: w.season.slug },
      });
      const casey = await myCard(db, w.casey.userId, w.season.slug);
      expect(casey?.stats.runs).toBe(4);
      const alex = await myCard(db, w.alex.userId, w.season.slug);
      expect(alex?.isPublic).toBe(true);
      expect(await seasonCardSummary(db, w.season.id)).toMatchObject({
        cards: 6,
        shared: 1,
      });
      const audits = await db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "season.cards"),
            eq(auditLog.entityId, w.season.id),
          ),
        );
      expect(audits.map((a) => a.after)).toEqual(
        expect.arrayContaining([
          { cards: 6, told: 6 },
          { cards: 6, told: 0 },
        ]),
      );
    });
  });
});

describe("sharing a card", () => {
  it("is private until the player makes it public, and private again", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      await w.complete();
      await w.build();
      const mine = await myCard(db, w.alex.userId, w.season.slug);
      expect(await publicCard(db, mine!.id)).toBeNull();
      expect(await publicCardIds(db)).not.toContainEqual(
        expect.objectContaining({ id: mine!.id }),
      );

      const shared = await setCardPublic(db, {
        userId: w.alex.userId,
        seasonSlug: w.season.slug,
        isPublic: true,
      });
      expect(shared.ok && shared.value.id).toBe(mine!.id);
      expect((await publicCard(db, mine!.id))?.stats.playerName).toBe(
        "Alex S.",
      );
      expect(await publicCardIds(db)).toContainEqual({
        id: mine!.id,
        seasonSlug: w.season.slug,
      });

      await setCardPublic(db, {
        userId: w.alex.userId,
        seasonSlug: w.season.slug,
        isPublic: false,
      });
      expect(await publicCard(db, mine!.id)).toBeNull();
    });
  });

  it("only changes the player's own card", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      await w.complete();
      await w.build();
      // The free agent played on no team, so has no card to share.
      expect(
        await setCardPublic(db, {
          userId: w.freeAgent.userId,
          seasonSlug: w.season.slug,
          isPublic: true,
        }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(await myCard(db, w.freeAgent.userId, w.season.slug)).toBeNull();
      expect(await seasonCardSummary(db, w.season.id)).toMatchObject({
        shared: 0,
      });
      expect(await myCards(db, w.alex.userId)).toEqual([
        { seasonSlug: w.season.slug, seasonName: "Fall 2026" },
      ]);
    });
  });
});

describe("the player's data", () => {
  it("exports the card and deletes it with the account", async () => {
    await inRolledBackDb(async (db) => {
      const w = await playedWorld(db);
      await w.complete();
      await w.build();
      const data = await personalData(db, w.casey.userId, NOW);
      expect(data?.seasonCards).toEqual([
        expect.objectContaining({
          season: "Fall 2026",
          isPublic: false,
          card: expect.objectContaining({ playerName: "Casey K." }),
        }),
      ]);
      const deleted = await deleteAccount(db, w.casey.userId, NOW);
      expect(deleted.ok).toBe(true);
      expect(
        await db
          .select()
          .from(seasonCard)
          .where(eq(seasonCard.userId, w.casey.userId)),
      ).toEqual([]);
    });
  });
});
