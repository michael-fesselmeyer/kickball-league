import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { NewPoll } from "@/domain/awards/awards";
import type { AwardPollId, LeagueId, SeasonId } from "@/domain/ids";
import { err, ok } from "@/domain/result";
import * as schema from "../schema";
import { auditLog } from "../schema/audit";
import { user } from "../schema/auth";
import { awardPoll, awardVote } from "../schema/awards";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { messagingWorld, type Player } from "../test/messaging-world";
import {
  closePool,
  expectViolation,
  inRolledBackDb,
  inRolledBackTransaction,
} from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import {
  ballotsFor,
  ballotsWaiting,
  castVote,
  closePollNow,
  gameDaysOf,
  openPoll,
  pollById,
  pollResults,
  removePoll,
  seasonPolls,
  votingPage,
} from "./awards";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-15T16:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

/**
 * The messaging world with names, a third team (Cats) that did not play on
 * Monday Sep 14, and Aces vs Bees that Monday afternoon in New York.
 */
async function awardsWorld(db: Db) {
  const w = await messagingWorld(db);
  const cats = await w.entry("Cats");
  const cat = await w.person("cat-1");
  await w.join(cats, cat, "captain");
  const named: [Player, string, string][] = [
    [w.aces.captain, "Robin", "Example"],
    [w.aces.players[0]!, "Alex", "Sample"],
    [w.aces.players[1]!, "Casey", "Kicker"],
    [w.bees.captain, "Jordan", "Other"],
    [w.bees.players[0]!, "Dee", "Bee"],
    [w.bees.players[1]!, "Sam", "Bee"],
    [cat, "Cara", "Cat"],
    [w.freeAgent, "Fran", "Free"],
  ];
  await db.insert(profile).values(
    named.map(([p, firstName, lastName]) => ({
      userId: p.userId,
      firstName,
      lastName,
    })),
  );
  await w.gameEnding(new Date("2026-09-14T20:00:00Z"));
  const pollOf = async (over: Partial<NewPoll> = {}) =>
    openPoll(db, {
      seasonId: w.season.id,
      actorId: w.aces.captain.userId,
      poll: {
        kind: "weekly",
        category: "mvp",
        gameDay: "2026-09-14",
        title: "MVP, Mon, Sep 14",
        opensAt: hours(-1),
        closesAt: hours(48),
        ...over,
      },
    });
  return { ...w, cats: { id: cats, captain: cat }, pollOf };
}

const vote = (db: Db, pollId: AwardPollId, voter: Player, nominee: string) =>
  castVote(db, { pollId, voterId: voter.userId, nomineeId: nominee, now: NOW });

describe("ballots", () => {
  it("lists the game day's players for a weekly award, everyone for a season award", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      expect(await gameDaysOf(db, w.season.id)).toEqual(["2026-09-14"]);
      const weekly = await pollById(db, await w.pollOf());
      const season = await pollById(
        db,
        await w.pollOf({ kind: "season", gameDay: null, title: "Season MVP" }),
      );
      const teams = await pollById(
        db,
        await w.pollOf({ category: "team_spirit", title: "Spirit" }),
      );
      const ballots = await ballotsFor(db, [weekly!, season!, teams!]);
      expect(ballots.get(weekly!.id)?.map((n) => n.name)).toEqual([
        "Alex S.",
        "Casey K.",
        "Dee B.",
        "Jordan O.",
        "Robin E.",
        "Sam B.",
      ]);
      expect(ballots.get(season!.id)?.map((n) => n.name)).toContain("Cara C.");
      expect(ballots.get(season!.id)?.map((n) => n.name)).not.toContain(
        "Fran F.",
      );
      expect(ballots.get(teams!.id)).toEqual([
        {
          id: w.aces.id,
          kind: "team",
          name: "Aces",
          teamSeasonId: w.aces.id,
          teamName: "Aces",
        },
        {
          id: w.bees.id,
          kind: "team",
          name: "Bees",
          teamSeasonId: w.bees.id,
          teamName: "Bees",
        },
      ]);
    });
  });
});

describe("casting a vote", () => {
  it("takes one vote per player per poll", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const pollId = await w.pollOf();
      const alex = w.aces.players[0]!;
      const picked = await vote(db, pollId, alex, w.bees.captain.userId);
      expect(picked.ok && picked.value.name).toBe("Jordan O.");
      expect(await vote(db, pollId, alex, w.aces.captain.userId)).toEqual(
        err("already_voted"),
      );
      const rows = await db
        .select()
        .from(awardVote)
        .where(eq(awardVote.awardPollId, pollId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.nomineeUserId).toBe(w.bees.captain.userId);
    });
  });

  it("refuses players off a roster, themselves, other games' players and closed polls", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const pollId = await w.pollOf();
      const robin = w.aces.captain;
      expect(await vote(db, pollId, w.freeAgent, robin.userId)).toEqual(
        err("not_on_roster"),
      );
      expect(await vote(db, pollId, robin, robin.userId)).toEqual(
        err("self_vote"),
      );
      // Cats did not play that day, so Cara is not on this week's ballot.
      expect(await vote(db, pollId, robin, w.cats.captain.userId)).toEqual(
        err("not_a_nominee"),
      );
      // A Cat can still vote: any rostered player in the season can.
      expect((await vote(db, pollId, w.cats.captain, robin.userId)).ok).toBe(
        true,
      );
      const closed = await w.pollOf({
        opensAt: hours(-5),
        closesAt: hours(-1),
      });
      expect(await vote(db, closed, robin, w.bees.captain.userId)).toEqual(
        err("not_open"),
      );
      expect(
        await vote(
          db,
          "00000000-0000-4000-8000-000000000000" as AwardPollId,
          robin,
          w.bees.captain.userId,
        ),
      ).toEqual(err("not_found"));
    });
  });

  it("keeps a team out of its own players' team award votes", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const pollId = await w.pollOf({
        category: "best_dressed",
        title: "Fits",
      });
      expect(await vote(db, pollId, w.aces.captain, w.aces.id)).toEqual(
        err("own_team"),
      );
      expect((await vote(db, pollId, w.aces.captain, w.bees.id)).ok).toBe(true);
      const [row] = await db
        .select()
        .from(awardVote)
        .where(eq(awardVote.awardPollId, pollId));
      expect(row?.nomineeTeamSeasonId).toBe(w.bees.id);
      expect(row?.nomineeUserId).toBeNull();
    });
  });
});

describe("the database's rules for votes", () => {
  it("allows one vote per poll and voter, one nominee, never yourself", async () => {
    await inRolledBackTransaction(async (sql) => {
      const [world] = await sql(
        `insert into league (name, slug) values ('Rules', 'rules-awards') returning id`,
      );
      const [s] = await sql(
        `insert into season (league_id, name, slug, starts_on, ends_on, fee_model, player_fee_cents, roster_min, roster_max) values ($1, 'Fall', 'fall', '2026-09-01', '2026-11-01', 'per_player', 8500, 1, 20) returning id`,
        [world?.id],
      );
      const [voter, other] = await sql(
        `insert into "user" (name, email) values ('A', 'awards-a@example.test'), ('B', 'awards-b@example.test') returning id`,
      );
      const [p] = await sql(
        `insert into award_poll (season_id, kind, category, title, closes_at) values ($1, 'season', 'mvp', 'MVP', now() + interval '1 day') returning id`,
        [s?.id],
      );
      const insertVote = (nominee: unknown, by = voter?.id) =>
        sql(
          `insert into award_vote (award_poll_id, voter_id, nominee_user_id) values ($1, $2, $3)`,
          [p?.id, by, nominee],
        );
      await insertVote(other?.id);
      await expectViolation(sql, "award_vote_once", () =>
        insertVote(other?.id),
      );
      await expectViolation(sql, "award_vote_not_self", () =>
        insertVote(other?.id, other?.id),
      );
      await expectViolation(sql, "award_vote_one_nominee", () =>
        insertVote(null, other?.id),
      );
      await expectViolation(sql, "award_poll_game_day_weekly", () =>
        sql(
          `insert into award_poll (season_id, kind, category, title, closes_at) values ($1, 'weekly', 'mvp', 'MVP', now() + interval '1 day')`,
          [s?.id],
        ),
      );
      await expectViolation(sql, "award_poll_times_order", () =>
        sql(
          `insert into award_poll (season_id, kind, category, title, opens_at, closes_at) values ($1, 'season', 'mvp', 'MVP', now(), now() - interval '1 hour')`,
          [s?.id],
        ),
      );
    });
  });
});

describe("results", () => {
  it("hides the count while open, then ranks with ties after close", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const pollId = await w.pollOf();
      const robin = w.aces.captain;
      const jordan = w.bees.captain;
      await vote(db, pollId, w.aces.players[0]!, jordan.userId);
      await vote(db, pollId, w.aces.players[1]!, jordan.userId);
      await vote(db, pollId, w.bees.players[0]!, robin.userId);
      await vote(db, pollId, w.bees.players[1]!, robin.userId);
      await vote(db, pollId, jordan, w.aces.players[0]!.userId);

      const open = await pollResults(db, pollId, NOW);
      expect(open?.state).toBe("open");
      expect(open?.results).toBeNull();

      const after = await pollResults(db, pollId, hours(49));
      expect(after?.state).toBe("closed");
      expect(after?.results?.total).toBe(5);
      expect(
        after?.results?.rows.map((r) => [r.name, r.teamName, r.votes, r.rank]),
      ).toEqual(
        // Ties are ordered by id, so compare the tied pair as a set.
        expect.arrayContaining([
          ["Robin E.", "Aces", 2, 1],
          ["Jordan O.", "Bees", 2, 1],
          ["Alex S.", "Aces", 1, 3],
        ]),
      );
      expect(after?.results?.winners.map((r) => r.name).sort()).toEqual([
        "Jordan O.",
        "Robin E.",
      ]);
    });
  });

  it("still names a winner who has left the roster", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const pollId = await w.pollOf();
      await vote(db, pollId, w.aces.captain, w.bees.players[0]!.userId);
      await db
        .update(rosterMembership)
        .set({ status: "removed" })
        .where(
          eq(
            rosterMembership.registrationId,
            w.bees.players[0]!.registrationId,
          ),
        );
      const after = await pollResults(db, pollId, hours(49));
      expect(after?.results?.winners).toEqual([
        expect.objectContaining({ name: "Dee B.", teamName: null, votes: 1 }),
      ]);
    });
  });
});

describe("the voting page", () => {
  it("shows open ballots with my own vote, and counts what is left to vote on", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const mvp = await w.pollOf();
      await w.pollOf({ category: "team_spirit", title: "Spirit" });
      const old = await w.pollOf({
        title: "Last week",
        opensAt: hours(-200),
        closesAt: hours(-100),
      });
      const alex = w.aces.players[0]!;
      expect(await ballotsWaiting(db, alex.userId, NOW)).toBe(2);
      await vote(db, mvp, alex, w.bees.captain.userId);
      expect(await ballotsWaiting(db, alex.userId, NOW)).toBe(1);

      const page = await votingPage(db, alex.userId, NOW);
      expect(page.onRoster).toBe(true);
      expect(
        page.ballots.map((b) => [b.poll.title, b.myVote, b.myTeamSeasonId]),
      ).toEqual([
        ["MVP, Mon, Sep 14", w.bees.captain.userId, w.aces.id],
        ["Spirit", null, w.aces.id],
      ]);
      expect(page.closed.map((p) => p.id)).toContain(old);

      const outsider = await votingPage(db, w.freeAgent.userId, NOW);
      expect(outsider).toMatchObject({ onRoster: false, ballots: [] });
      expect(await ballotsWaiting(db, w.freeAgent.userId, NOW)).toBe(0);
    });
  });
});

describe("running polls", () => {
  it("closes early and removes, with an audit row for each", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const actorId = w.aces.captain.userId;
      const pollId = await w.pollOf();
      expect(
        await closePollNow(db, {
          pollId,
          seasonId: w.season.id,
          actorId,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      expect((await pollById(db, pollId))?.closesAt).toEqual(NOW);
      expect(
        await closePollNow(db, {
          pollId,
          seasonId: w.season.id,
          actorId,
          now: NOW,
        }),
      ).toEqual(err("not_open"));
      expect(
        await removePoll(db, {
          pollId,
          seasonId: "00000000-0000-4000-8000-000000000000" as SeasonId,
          actorId,
        }),
      ).toEqual(err("not_found"));
      expect(
        await removePoll(db, { pollId, seasonId: w.season.id, actorId }),
      ).toEqual(ok(undefined));
      expect(await seasonPolls(db, w.season.id)).toEqual([]);
      const audits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, pollId));
      expect(audits.map((a) => a.action).sort()).toEqual([
        "awards.close",
        "awards.open",
        "awards.remove",
      ]);
    });
  });
});

describe("a player's own data", () => {
  it("exports their votes, and deleting the account withdraws only open ones", async () => {
    await inRolledBackDb(async (db) => {
      const w = await awardsWorld(db);
      const alex = w.aces.players[0]!;
      const closedPoll = await w.pollOf({ title: "Old", closesAt: hours(1) });
      await vote(db, closedPoll, alex, w.bees.captain.userId);
      const openPollId = await w.pollOf({
        category: "best_dressed",
        title: "Fits",
      });
      await vote(db, openPollId, alex, w.bees.id);
      const data = await personalData(db, alex.userId, NOW);
      expect(data?.awardVotes).toEqual([
        { poll: "Old", castAt: NOW, pick: "Jordan O." },
        { poll: "Fits", castAt: NOW, pick: "Bees" },
      ]);
      expect((await deleteAccount(db, alex.userId, hours(2))).ok).toBe(true);
      const left = await db
        .select({ pollId: awardVote.awardPollId })
        .from(awardVote)
        .where(eq(awardVote.voterId, alex.userId));
      expect(left).toEqual([{ pollId: closedPoll }]);
    });
  });
});

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
  await db.delete(awardPoll).where(inArray(awardPoll.seasonId, seasons));
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
  const ids = people.map((p) => p.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, ids));
    await db.delete(profile).where(inArray(profile.userId, ids));
    await db.delete(user).where(inArray(user.id, ids));
  }
}

describe("two votes at once", () => {
  it("counts exactly one when a player sends two at the same moment", async () => {
    const clients: Client[] = [];
    const setup = await connect(clients);
    const w = await awardsWorld(setup);
    try {
      const alex = w.aces.players[0]!;
      for (let round = 0; round < 5; round++) {
        const pollId = await w.pollOf({ title: `Race ${round}` });
        const [a, b] = [await connect(clients), await connect(clients)];
        const results = await Promise.all([
          vote(a, pollId, alex, w.bees.captain.userId),
          vote(b, pollId, alex, w.aces.captain.userId),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toEqual([err("already_voted")]);
        const rows = await setup
          .select({ id: awardVote.id })
          .from(awardVote)
          .where(
            and(
              eq(awardVote.awardPollId, pollId),
              eq(awardVote.voterId, alex.userId),
            ),
          );
        expect(rows).toHaveLength(1);
      }
    } finally {
      await removeWorld(setup, w.leagueId);
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
