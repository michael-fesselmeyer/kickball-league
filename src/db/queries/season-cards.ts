import { and, asc, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { CATEGORIES } from "@/domain/awards/awards";
import { seasonChampion } from "@/domain/history/history";
import type { LeagueId, SeasonCardId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  awardsWon,
  buildCard,
  type ClosedPoll,
  isCurrentCard,
  type Outcome,
  type SeasonCardStats,
  type TeamGame,
} from "@/domain/season-card/card";
import { awardPoll, awardVote } from "../schema/awards";
import { user } from "../schema/auth";
import { game, gamePeriod, gameRsvp, slot } from "../schema/game";
import { league } from "../schema/league";
import { gameLineup, gameLineupSpot } from "../schema/lineup";
import { bracket } from "../schema/playoffs";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { seasonCard } from "../schema/season-card";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";
import { seasonStandings } from "./standings";

/**
 * "Your season in kickball" (docs/product-spec.md; docs/data-model.md,
 * section 2.5). An admin builds the cards once the season is completed;
 * every player on a roster gets one, stored, and one non-urgent message.
 * Building again refreshes the numbers and keeps each card's sharing
 * choice; the message is never sent twice.
 */

const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

/** The players a season's cards are for: everyone active on a roster. */
async function rosterPlayers(db: Db, seasonId: SeasonId) {
  return db
    .select({
      userId: registration.userId,
      teamSeasonId: rosterMembership.teamSeasonId,
      name: shortName,
      teamName: team.name,
      teamSlug: team.slug,
      colorHex: team.colorHex,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(registration.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
}

/** Every finished game of the season, with its game day in league time. */
async function finishedGames(db: Db, seasonId: SeasonId, timeZone: string) {
  return db
    .select({
      id: game.id,
      teamA: game.teamAId,
      teamB: game.teamBId,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      status: game.status,
      kind: game.kind,
      forfeitBy: game.forfeitBy,
      kicksFirst: game.kicksFirst,
      day: sql<string>`to_char(coalesce(${slot.startsAt}, ${game.finalizedAt}) at time zone ${timeZone}, 'YYYY-MM-DD')`,
    })
    .from(game)
    .leftJoin(slot, eq(slot.id, game.slotId))
    .where(
      and(
        eq(game.seasonId, seasonId),
        inArray(game.status, ["final", "forfeit"]),
      ),
    )
    .orderBy(asc(sql`coalesce(${slot.startsAt}, ${game.finalizedAt})`));
}

type FinishedGame = Awaited<ReturnType<typeof finishedGames>>[number];

/** One game from one team's side; null when the team did not play in it. */
function fromSide(
  g: FinishedGame,
  teamSeasonId: string,
  names: ReadonlyMap<string, string>,
): TeamGame | null {
  const isA = g.teamA === teamSeasonId;
  if (!isA && g.teamB !== teamSeasonId) return null;
  const opponentId = isA ? g.teamB : g.teamA;
  const opponent = names.get(opponentId) ?? "Another team";
  const base = {
    gameId: g.id,
    day: g.day,
    opponent,
    playoff: g.kind === "playoff",
  };
  if (g.status === "forfeit") {
    const outcome: Outcome = g.forfeitBy === teamSeasonId ? "L" : "W";
    return { ...base, runsFor: null, runsAgainst: null, outcome };
  }
  const runsFor = (isA ? g.scoreA : g.scoreB) ?? 0;
  const runsAgainst = (isA ? g.scoreB : g.scoreA) ?? 0;
  const outcome: Outcome =
    runsFor > runsAgainst ? "W" : runsFor < runsAgainst ? "L" : "T";
  return { ...base, runsFor, runsAgainst, outcome };
}

/** The data every card in the season reads, in one parallel round. */
async function seasonInputs(
  db: Db,
  seasonId: SeasonId,
  timeZone: string,
  now: Date,
) {
  const games = finishedGames(db, seasonId, timeZone);
  const [
    finished,
    rsvps,
    spots,
    periods,
    standings,
    champion,
    polls,
    voteCounts,
    votesCast,
  ] = await Promise.all([
    games,
    db
      .select({
        gameId: gameRsvp.gameId,
        userId: gameRsvp.userId,
        status: gameRsvp.status,
      })
      .from(gameRsvp)
      .innerJoin(game, eq(game.id, gameRsvp.gameId))
      .where(eq(game.seasonId, seasonId)),
    db
      .select({ gameId: gameLineup.gameId, userId: gameLineupSpot.userId })
      .from(gameLineupSpot)
      .innerJoin(gameLineup, eq(gameLineup.id, gameLineupSpot.lineupId))
      .innerJoin(game, eq(game.id, gameLineup.gameId))
      // A sub kicking for another team is not at their own team's game.
      .where(
        and(eq(game.seasonId, seasonId), eq(gameLineupSpot.pickup, false)),
      ),
    db
      .select({
        gameId: gamePeriod.gameId,
        half: gamePeriod.half,
        runs: gamePeriod.runs,
      })
      .from(gamePeriod)
      .innerJoin(game, eq(game.id, gamePeriod.gameId))
      .where(eq(game.seasonId, seasonId)),
    seasonStandings(db, seasonId),
    db
      .select({ championId: bracket.championId })
      .from(bracket)
      .where(
        and(
          eq(bracket.seasonId, seasonId),
          eq(bracket.status, "complete"),
          sql`${bracket.divisionId} is null`,
        ),
      )
      .limit(1),
    db
      .select({
        id: awardPoll.id,
        title: awardPoll.title,
        category: awardPoll.category,
      })
      .from(awardPoll)
      .where(
        and(eq(awardPoll.seasonId, seasonId), lte(awardPoll.closesAt, now)),
      )
      .orderBy(asc(awardPoll.closesAt), asc(awardPoll.title)),
    db
      .select({
        pollId: awardVote.awardPollId,
        userId: awardVote.nomineeUserId,
        teamSeasonId: awardVote.nomineeTeamSeasonId,
        votes: count(),
      })
      .from(awardVote)
      .innerJoin(awardPoll, eq(awardPoll.id, awardVote.awardPollId))
      .where(
        and(eq(awardPoll.seasonId, seasonId), lte(awardPoll.closesAt, now)),
      )
      .groupBy(
        awardVote.awardPollId,
        awardVote.nomineeUserId,
        awardVote.nomineeTeamSeasonId,
      ),
    db
      .select({ userId: awardVote.voterId, votes: count() })
      .from(awardVote)
      .innerJoin(awardPoll, eq(awardPoll.id, awardVote.awardPollId))
      .where(eq(awardPoll.seasonId, seasonId))
      .groupBy(awardVote.voterId),
  ]);
  return {
    finished,
    rsvps,
    spots,
    periods,
    standings,
    championId: champion[0]?.championId ?? null,
    polls: polls.map((p): ClosedPoll => ({
      id: p.id,
      title: p.title,
      team: CATEGORIES[p.category].nominee === "team",
    })),
    voteCounts: voteCounts.flatMap((c) => {
      const nomineeId = c.userId ?? c.teamSeasonId;
      return nomineeId
        ? [
            {
              pollId: c.pollId,
              nomineeId,
              votes: c.votes,
            },
          ]
        : [];
    }),
    votesCast: new Map(votesCast.map((v) => [v.userId as string, v.votes])),
  };
}

/**
 * Each player's card, built from the season's data. Exported for the
 * database tests; `buildSeasonCards` stores them.
 */
export async function seasonCardsFor(
  db: Db,
  seasonId: SeasonId,
  now: Date,
): Promise<{ userId: UserId; stats: SeasonCardStats }[]> {
  const [info] = await db
    .select({
      name: season.name,
      status: season.status,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(league.id, season.leagueId))
    .where(eq(season.id, seasonId));
  if (!info) return [];
  const [players, data] = await Promise.all([
    rosterPlayers(db, seasonId),
    seasonInputs(db, seasonId, info.timeZone, now),
  ]);
  const { rows, teams } = data.standings;
  const names = new Map([...teams].map(([id, t]) => [id, t.name]));

  // Who said they were in, or kicked, and who answered at all.
  const attended = new Map<string, Set<string>>();
  const answered = new Set<string>();
  const mark = (userId: string, gameId: string) => {
    const set = attended.get(userId) ?? new Set<string>();
    set.add(gameId);
    attended.set(userId, set);
  };
  for (const r of data.rsvps) {
    answered.add(r.userId);
    if (r.status === "in") mark(r.userId, r.gameId);
  }
  for (const s of data.spots) {
    answered.add(s.userId);
    mark(s.userId, s.gameId);
  }

  // The halves each side kicked, from who kicked first.
  const halves = new Map<string, { top: number[]; bottom: number[] }>();
  for (const p of data.periods) {
    const h = halves.get(p.gameId) ?? { top: [], bottom: [] };
    h[p.half].push(p.runs);
    halves.set(p.gameId, h);
  }

  const champion = seasonChampion({
    seasonId,
    completed: info.status === "completed",
    rows,
    bracketChampion: data.championId,
  });

  const byTeam = new Map<string, TeamGame[]>();
  const inningsByTeam = new Map<string, Map<string, number[]>>();
  for (const teamSeasonId of new Set(players.map((p) => p.teamSeasonId))) {
    const games: TeamGame[] = [];
    const innings = new Map<string, number[]>();
    for (const g of data.finished) {
      const side = fromSide(g, teamSeasonId, names);
      if (!side) continue;
      games.push(side);
      const h = halves.get(g.id);
      if (h && g.kicksFirst)
        innings.set(g.id, g.kicksFirst === teamSeasonId ? h.top : h.bottom);
    }
    byTeam.set(teamSeasonId, games);
    inningsByTeam.set(teamSeasonId, innings);
  }

  return players.map((p) => {
    const row = rows.find((r) => r.teamId === p.teamSeasonId);
    return {
      userId: p.userId,
      stats: buildCard({
        playerName: p.name,
        seasonName: info.name,
        team: { name: p.teamName, slug: p.teamSlug, colorHex: p.colorHex },
        games: byTeam.get(p.teamSeasonId) ?? [],
        player: {
          attended: attended.get(p.userId) ?? new Set(),
          tracked: answered.has(p.userId),
        },
        innings: inningsByTeam.get(p.teamSeasonId) ?? new Map(),
        record: row
          ? { wins: row.wins, losses: row.losses, ties: row.ties }
          : { wins: 0, losses: 0, ties: 0 },
        finish:
          row && row.played > 0
            ? {
                rank: row.rank,
                of: rows.length,
                champion: champion === p.teamSeasonId,
              }
            : null,
        awardsWon: awardsWon(data.polls, data.voteCounts, {
          userId: p.userId,
          teamSeasonId: p.teamSeasonId,
        }),
        votesCast: data.votesCast.get(p.userId) ?? 0,
      }),
    };
  });
}

export type BuildError = "not_found" | "not_completed";

/**
 * Builds or refreshes every card of a completed season and queues each
 * new card's message, in one transaction. Returns how many cards there
 * are and how many players were told for the first time.
 */
export async function buildSeasonCards(
  db: Db,
  input: { seasonId: SeasonId; actorId: UserId; now: Date },
): Promise<Result<{ cards: number; told: number; slug: string }, BuildError>> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ slug: season.slug, name: season.name, status: season.status })
      .from(season)
      .where(eq(season.id, input.seasonId))
      .for("update");
    if (!found) return err("not_found");
    if (found.status !== "completed") return err("not_completed");
    const cards = await seasonCardsFor(tx, input.seasonId, input.now);
    if (cards.length > 0)
      await tx
        .insert(seasonCard)
        .values(
          cards.map((c) => ({
            seasonId: input.seasonId,
            userId: c.userId,
            stats: c.stats,
            builtAt: input.now,
          })),
        )
        .onConflictDoUpdate({
          target: [seasonCard.seasonId, seasonCard.userId],
          set: {
            stats: sql`excluded.stats`,
            builtAt: sql`excluded.built_at`,
          },
        });
    const told = await enqueueMessages(
      tx,
      cards.map((c) => ({
        userId: c.userId,
        template: "season_card" as const,
        topic: "announcement" as const,
        payload: { seasonName: found.name, seasonSlug: found.slug },
        dedupeKey: `season_card/${input.seasonId}/${c.userId}`,
      })),
    );
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "season.cards",
      entityType: "season",
      entityId: input.seasonId,
      after: { cards: cards.length, told },
    });
    return ok({ cards: cards.length, told, slug: found.slug });
  });
}

/** For the admin page: how many cards a season has and how many are public. */
export async function seasonCardSummary(db: Db, seasonId: SeasonId) {
  const [row] = await db
    .select({
      cards: count(),
      shared: sql<number>`count(*) filter (where ${seasonCard.isPublic})::int`,
      builtAt: sql<Date | null>`max(${seasonCard.builtAt})`,
    })
    .from(seasonCard)
    .where(eq(seasonCard.seasonId, seasonId));
  return {
    cards: row?.cards ?? 0,
    shared: row?.shared ?? 0,
    builtAt: row?.builtAt ? new Date(row.builtAt) : null,
  };
}

export type CardRow = {
  id: SeasonCardId;
  seasonId: SeasonId;
  seasonSlug: string;
  isPublic: boolean;
  stats: SeasonCardStats;
};

const cardColumns = {
  id: seasonCard.id,
  seasonId: seasonCard.seasonId,
  seasonSlug: season.slug,
  isPublic: seasonCard.isPublic,
  stats: seasonCard.stats,
};

const current = <Row extends { stats: unknown }>(row: Row | undefined) =>
  row && isCurrentCard(row.stats) ? (row as Row & CardRow) : null;

/** A player's own card for a season, public or not. */
export async function myCard(
  db: Db,
  userId: UserId,
  seasonSlug: string,
  leagueId?: LeagueId | null,
): Promise<CardRow | null> {
  const [row] = await db
    .select(cardColumns)
    .from(seasonCard)
    .innerJoin(season, eq(season.id, seasonCard.seasonId))
    .where(
      and(
        eq(seasonCard.userId, userId),
        eq(season.slug, seasonSlug),
        // The season of that name in the league on show (ADR 0048).
        leagueId ? eq(season.leagueId, leagueId) : undefined,
      ),
    )
    .limit(1);
  return current(row);
}

/** A player's cards, newest season first, for the signed-in home. */
export async function myCards(
  db: Db,
  userId: UserId,
  leagueId?: LeagueId | null,
) {
  return db
    .select({ seasonSlug: season.slug, seasonName: season.name })
    .from(seasonCard)
    .innerJoin(season, eq(season.id, seasonCard.seasonId))
    .where(
      and(
        eq(seasonCard.userId, userId),
        leagueId ? eq(season.leagueId, leagueId) : undefined,
      ),
    )
    .orderBy(desc(season.startsOn));
}

/** A card anyone can see: only one its player made public, in `leagueId` when given. */
export async function publicCard(
  db: Db,
  id: SeasonCardId,
  leagueId?: LeagueId,
): Promise<CardRow | null> {
  const [row] = await db
    .select(cardColumns)
    .from(seasonCard)
    .innerJoin(season, eq(season.id, seasonCard.seasonId))
    .where(
      and(
        eq(seasonCard.id, id),
        eq(seasonCard.isPublic, true),
        // On a league's page, only that league's cards (ADR 0048).
        leagueId ? eq(season.leagueId, leagueId) : undefined,
      ),
    )
    .limit(1);
  return current(row);
}

/** The player makes their card's link public, or private again. */
export async function setCardPublic(
  db: Db,
  input: {
    userId: UserId;
    seasonSlug: string;
    leagueId?: LeagueId | null;
    isPublic: boolean;
  },
): Promise<Result<CardRow, "not_found">> {
  const card = await myCard(db, input.userId, input.seasonSlug, input.leagueId);
  if (!card) return err("not_found");
  await db
    .update(seasonCard)
    .set({ isPublic: input.isPublic })
    .where(
      and(eq(seasonCard.id, card.id), eq(seasonCard.userId, input.userId)),
    );
  return ok({ ...card, isPublic: input.isPublic });
}

/** Every public card's id, to prerender their pages at build time. */
export async function publicCardIds(db: Db, leagueId: LeagueId) {
  return db
    .select({ id: seasonCard.id, seasonSlug: season.slug })
    .from(seasonCard)
    .innerJoin(season, eq(season.id, seasonCard.seasonId))
    .where(and(eq(season.leagueId, leagueId), eq(seasonCard.isPublic, true)));
}
