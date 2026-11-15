import {
  type AnyColumn,
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import {
  attendanceAt,
  type AwardsResult,
  computeAwards,
  type MvpPart,
  type MvpWeights,
  type PlayerGame,
  type PlayerSeason,
  type StatAward,
  STAT_AWARD_KEYS,
  SUGGESTS_FOR,
} from "@/domain/awards/stat-awards";
import type { SeasonId, TeamSeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { awardPoll, awardVote } from "../schema/awards";
import { sportsmanshipRating } from "../schema/discipline";
import { game, gamePeriod, gameRsvp, slot } from "../schema/game";
import { league } from "../schema/league";
import { gameLineup, gameLineupSpot } from "../schema/lineup";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { checkin } from "../schema/sponsor";
import {
  leaderboardOptOut,
  type StatAwardDetail,
  statAwardPlace,
  statAwardSet,
} from "../schema/stat-awards";
import { subClaim, subRequest } from "../schema/subs";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Stat awards and player stats (ADR 0046; docs/data-model.md, section
 * 2.5). The inputs come from what the app already records: final games,
 * saved kicking orders, RSVPs, bar check-ins, live half-inning runs,
 * sportsmanship ratings, sub claims and closed award polls.
 */

const shortName = (first: string, lastInitial: string | null) =>
  lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;

/** A game's start as a date on the league's wall clock. */
const localDay = sql<string>`to_char(${slot.startsAt} at time zone ${league.timezone}, 'YYYY-MM-DD')`;

export type RosterPlayer = {
  seasonId: SeasonId;
  userId: UserId;
  teamSeasonId: TeamSeasonId;
  teamName: string;
  name: string | null;
};

/**
 * Every player's season in the given seasons, or only one person's, in
 * nine queries however many players and games there are.
 */
export async function gatherSeasons(
  db: Db,
  seasonIds: readonly SeasonId[],
  options: { userId?: UserId } = {},
): Promise<{ roster: RosterPlayer[]; seasons: Map<string, PlayerSeason> }> {
  const seasons = new Map<string, PlayerSeason>();
  if (seasonIds.length === 0) return { roster: [], seasons };
  const ids = [...seasonIds];
  const onlyUser = options.userId;

  const rosterRows = await db
    .select({
      seasonId: registration.seasonId,
      seasonStarts: season.startsOn,
      leagueId: season.leagueId,
      userId: registration.userId,
      teamSeasonId: rosterMembership.teamSeasonId,
      teamName: team.name,
      firstName: profile.firstName,
      lastInitial: sql<string | null>`left(${profile.lastName}, 1)`,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(season, eq(registration.seasonId, season.id))
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .leftJoin(profile, eq(registration.userId, profile.userId))
    .where(
      and(
        inArray(registration.seasonId, ids),
        eq(rosterMembership.status, "active"),
        onlyUser ? eq(registration.userId, onlyUser) : undefined,
      ),
    );
  if (rosterRows.length === 0) return { roster: [], seasons };
  const userIds = [...new Set(rosterRows.map((r) => r.userId))];
  const teamIds = [...new Set(rosterRows.map((r) => r.teamSeasonId))];

  const finals = await db
    .select({
      id: game.id,
      seasonId: game.seasonId,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      kicksFirst: game.kicksFirst,
      day: localDay,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        inArray(game.seasonId, ids),
        eq(game.status, "final"),
        ne(game.kind, "exhibition"),
      ),
    )
    // In the order they were played, so each player's games read the same
    // way every time.
    .orderBy(asc(slot.startsAt), asc(game.id));
  const gameIds = finals.map((g) => g.id);
  const days = [...new Set(finals.map((g) => g.day))];
  const none = Promise.resolve([] as never[]);

  const [lineups, spots, rsvps, visits, halves, ratings, subs, votes, earlier] =
    await Promise.all([
      gameIds.length
        ? db
            .select({
              gameId: gameLineup.gameId,
              teamSeasonId: gameLineup.teamSeasonId,
            })
            .from(gameLineup)
            .where(inArray(gameLineup.gameId, gameIds))
        : none,
      gameIds.length
        ? db
            .select({
              gameId: gameLineup.gameId,
              teamSeasonId: gameLineup.teamSeasonId,
              userId: gameLineupSpot.userId,
            })
            .from(gameLineupSpot)
            .innerJoin(gameLineup, eq(gameLineupSpot.lineupId, gameLineup.id))
            .where(
              and(
                inArray(gameLineup.gameId, gameIds),
                inArray(gameLineupSpot.userId, userIds),
              ),
            )
        : none,
      gameIds.length
        ? db
            .select({
              gameId: gameRsvp.gameId,
              userId: gameRsvp.userId,
              status: gameRsvp.status,
            })
            .from(gameRsvp)
            .where(
              and(
                inArray(gameRsvp.gameId, gameIds),
                inArray(gameRsvp.userId, userIds),
              ),
            )
        : none,
      days.length
        ? db
            .selectDistinct({ userId: checkin.userId, day: checkin.onDate })
            .from(checkin)
            .where(
              and(
                inArray(checkin.userId, userIds),
                inArray(checkin.onDate, days),
              ),
            )
        : none,
      gameIds.length
        ? db
            .select({
              gameId: gamePeriod.gameId,
              half: gamePeriod.half,
              runs: sql<number>`sum(${gamePeriod.runs})::int`,
            })
            .from(gamePeriod)
            .where(inArray(gamePeriod.gameId, gameIds))
            .groupBy(gamePeriod.gameId, gamePeriod.half)
        : none,
      gameIds.length
        ? db
            .select({
              gameId: sportsmanshipRating.gameId,
              teamSeasonId: sportsmanshipRating.ratedTeamSeasonId,
              score: sql<number>`avg(${sportsmanshipRating.score})::float8`,
            })
            .from(sportsmanshipRating)
            .where(
              and(
                inArray(sportsmanshipRating.gameId, gameIds),
                inArray(sportsmanshipRating.ratedTeamSeasonId, teamIds),
              ),
            )
            .groupBy(
              sportsmanshipRating.gameId,
              sportsmanshipRating.ratedTeamSeasonId,
            )
        : none,
      gameIds.length
        ? db
            .select({
              seasonId: game.seasonId,
              userId: subClaim.userId,
              n: count(),
            })
            .from(subClaim)
            .innerJoin(subRequest, eq(subClaim.subRequestId, subRequest.id))
            .innerJoin(game, eq(subRequest.gameId, game.id))
            .where(
              and(
                inArray(game.id, gameIds),
                eq(subClaim.status, "approved"),
                inArray(subClaim.userId, userIds),
              ),
            )
            .groupBy(game.seasonId, subClaim.userId)
        : none,
      // Closed polls only: a running count is never read.
      db
        .select({
          seasonId: awardPoll.seasonId,
          kind: awardPoll.kind,
          category: awardPoll.category,
          userId: awardVote.nomineeUserId,
          n: count(),
        })
        .from(awardVote)
        .innerJoin(awardPoll, eq(awardVote.awardPollId, awardPoll.id))
        .where(
          and(
            inArray(awardPoll.seasonId, ids),
            inArray(awardPoll.category, ["mvp", "best_sport"]),
            lte(awardPoll.closesAt, sql`now()`),
            isNotNull(awardVote.nomineeUserId),
          ),
        )
        .groupBy(
          awardPoll.seasonId,
          awardPoll.kind,
          awardPoll.category,
          awardVote.nomineeUserId,
        ),
      // Each player's earliest season start in the league.
      db
        .select({
          userId: registration.userId,
          leagueId: season.leagueId,
          first: sql<string>`min(${season.startsOn})`,
        })
        .from(registration)
        .innerJoin(season, eq(registration.seasonId, season.id))
        .where(inArray(registration.userId, userIds))
        .groupBy(registration.userId, season.leagueId),
    ]);

  const key2 = (a: string, b: string) => `${a}|${b}`;
  const lineupSaved = new Set(
    lineups.map((l) => key2(l.gameId, l.teamSeasonId)),
  );
  const inLineup = new Set(
    spots.map((s) => `${s.gameId}|${s.teamSeasonId}|${s.userId}`),
  );
  const rsvpOf = new Map(rsvps.map((r) => [key2(r.gameId, r.userId), r]));
  const visited = new Set(visits.map((v) => key2(v.userId, v.day)));
  const halfRuns = new Map(
    halves.map((h) => [key2(h.gameId, h.half), Number(h.runs)]),
  );
  const ratingOf = new Map(
    ratings.map((r) => [key2(r.gameId, r.teamSeasonId), Number(r.score)]),
  );
  const subsOf = new Map(subs.map((s) => [key2(s.seasonId, s.userId), s.n]));
  const firstStart = new Map(
    earlier.map((e) => [key2(e.userId, e.leagueId), e.first]),
  );
  const votesOf = (seasonId: string, userId: string, mvp: boolean) =>
    votes
      .filter(
        (v) =>
          v.seasonId === seasonId &&
          v.userId === userId &&
          (mvp
            ? v.category === "mvp" && v.kind === "season"
            : v.category === "best_sport"),
      )
      .reduce((n, v) => n + v.n, 0);

  /** The team's runs from the live line score, or null if not live scored. */
  function liveRuns(g: (typeof finals)[number], teamId: string) {
    if (!g.kicksFirst) return null;
    const top = halfRuns.get(key2(g.id, "top"));
    const bottom = halfRuns.get(key2(g.id, "bottom"));
    if (top === undefined && bottom === undefined) return null;
    return (g.kicksFirst === teamId ? top : bottom) ?? 0;
  }

  const roster: RosterPlayer[] = [];
  for (const r of rosterRows) {
    roster.push({
      seasonId: r.seasonId,
      userId: r.userId,
      teamSeasonId: r.teamSeasonId,
      teamName: r.teamName,
      name: r.firstName ? shortName(r.firstName, r.lastInitial) : null,
    });
    const teamGames = finals.filter(
      (g) => g.teamAId === r.teamSeasonId || g.teamBId === r.teamSeasonId,
    );
    const games: PlayerGame[] = teamGames.map((g) => {
      const rsvp = rsvpOf.get(key2(g.id, r.userId));
      const isA = g.teamAId === r.teamSeasonId;
      const mine = (isA ? g.scoreA : g.scoreB) ?? 0;
      const theirs = (isA ? g.scoreB : g.scoreA) ?? 0;
      return {
        attendance: attendanceAt({
          lineupSaved: lineupSaved.has(key2(g.id, r.teamSeasonId)),
          inLineup: inLineup.has(`${g.id}|${r.teamSeasonId}|${r.userId}`),
          rsvp: rsvp?.status ?? null,
          checkedInThatDay: visited.has(key2(r.userId, g.day)),
        }),
        won: mine > theirs,
        liveRuns: liveRuns(g, r.teamSeasonId),
        rating: ratingOf.get(key2(g.id, r.teamSeasonId)) ?? null,
      };
    });
    seasons.set(key2(r.seasonId, r.userId), {
      userId: r.userId,
      games,
      subAppearances: subsOf.get(key2(r.seasonId, r.userId)) ?? 0,
      mvpVotes: votesOf(r.seasonId, r.userId, true),
      bestSportVotes: votesOf(r.seasonId, r.userId, false),
      firstSeason:
        firstStart.get(key2(r.userId, r.leagueId)) === r.seasonStarts,
    });
  }
  return { roster, seasons };
}

/** Who asked to stay off public leaderboards, among these people. */
async function optedOut(db: Db, userIds: readonly UserId[]) {
  if (userIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ userId: leaderboardOptOut.userId })
    .from(leaderboardOptOut)
    .where(inArray(leaderboardOptOut.userId, [...userIds]));
  return new Set<string>(rows.map((r) => r.userId));
}

/**
 * Works a season's stat awards out now, without saving: everyone on a
 * roster except players who opted out of public leaderboards.
 */
export async function previewAwards(
  db: Db,
  seasonId: SeasonId,
  weights: MvpWeights,
): Promise<{ result: AwardsResult; roster: RosterPlayer[]; hidden: number }> {
  const { roster, seasons } = await gatherSeasons(db, [seasonId]);
  const out = await optedOut(
    db,
    roster.map((r) => r.userId),
  );
  // Nobody without a name can be shown, so nobody without one can win.
  const shown = roster.filter((r) => r.name !== null && !out.has(r.userId));
  const players = shown.flatMap((r) => {
    const p = seasons.get(`${seasonId}|${r.userId}`);
    return p ? [p] : [];
  });
  return {
    result: computeAwards(players, weights),
    roster: shown,
    hidden: roster.filter((r) => out.has(r.userId)).length,
  };
}

function detailFor(
  award: StatAward,
  userId: string,
  result: AwardsResult,
): StatAwardDetail {
  const s = result.stats.find((x) => x.userId === userId);
  if (!s) return {};
  switch (award) {
    case "golden_boot":
      return { recorded: s.liveGames, of: s.gamesPlayed };
    case "sub_of_the_year":
      return {};
    case "best_teammate":
      // The ratings' coverage when they counted, else the attendance's.
      return s.sportsmanship === null
        ? { recorded: s.recorded, of: s.teamGames }
        : { recorded: s.ratedGames, of: s.gamesPlayed };
    case "season_mvp":
    case "rookie_of_the_year": {
      const parts = result.mvp.find((m) => m.userId === userId)?.parts;
      return parts
        ? { recorded: s.recorded, of: s.teamGames, parts }
        : { recorded: s.recorded, of: s.teamGames };
    }
    default:
      return { recorded: s.recorded, of: s.teamGames };
  }
}

export type ComputeError = "published";

/**
 * Works the awards out and saves them as the season's draft, replacing
 * any earlier draft's places but keeping admins' notes. A published set
 * has to be taken down first.
 */
export async function computeStatAwards(
  db: Db,
  input: {
    seasonId: SeasonId;
    weights: MvpWeights;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<AwardsResult, ComputeError>> {
  const { result, roster } = await previewAwards(
    db,
    input.seasonId,
    input.weights,
  );
  const teamOf = new Map(roster.map((r) => [r.userId, r.teamSeasonId]));
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ publishedAt: statAwardSet.publishedAt })
      .from(statAwardSet)
      .where(eq(statAwardSet.seasonId, input.seasonId))
      .for("update");
    if (existing?.publishedAt) return err("published");
    const values = {
      weights: input.weights,
      unusedParts: result.unusedParts,
      votesCounted: result.votesCounted,
      computedAt: input.now,
      computedBy: input.actorId,
    };
    await tx
      .insert(statAwardSet)
      .values({ seasonId: input.seasonId, ...values })
      .onConflictDoUpdate({ target: statAwardSet.seasonId, set: values });
    await tx
      .delete(statAwardPlace)
      .where(eq(statAwardPlace.seasonId, input.seasonId));
    const places = STAT_AWARD_KEYS.flatMap((award) =>
      result.leaders[award].map((l) => ({
        seasonId: input.seasonId,
        award,
        userId: l.userId as UserId,
        teamSeasonId: teamOf.get(l.userId as UserId) ?? null,
        place: l.place,
        value: l.value,
        detail: detailFor(award, l.userId, result),
      })),
    );
    if (places.length) await tx.insert(statAwardPlace).values(places);
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "stat_awards.compute",
      entityType: "season",
      entityId: input.seasonId,
      after: { weights: input.weights, places: places.length },
    });
    return ok(result);
  });
}

/** Publishes the season's computed awards, or takes them down. */
export async function setStatAwardsPublished(
  db: Db,
  input: {
    seasonId: SeasonId;
    publish: boolean;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_computed">> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(statAwardSet)
      .set(
        input.publish
          ? { publishedAt: input.now, publishedBy: input.actorId }
          : { publishedAt: null, publishedBy: null },
      )
      .where(eq(statAwardSet.seasonId, input.seasonId))
      .returning({ seasonId: statAwardSet.seasonId });
    if (!updated) return err("not_computed");
    await recordAudit(tx, {
      actorId: input.actorId,
      action: input.publish ? "stat_awards.publish" : "stat_awards.unpublish",
      entityType: "season",
      entityId: input.seasonId,
    });
    return ok(undefined);
  });
}

/** Saves (or, with null, clears) an admin's note on one award. */
export async function saveStatAwardNote(
  db: Db,
  input: {
    seasonId: SeasonId;
    award: StatAward;
    note: string | null;
    actorId: UserId;
  },
): Promise<Result<void, "not_computed">> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(statAwardSet)
      .set({
        notes: input.note
          ? sql`${statAwardSet.notes} || jsonb_build_object(${input.award}::text, ${input.note}::text)`
          : sql`${statAwardSet.notes} - ${input.award}::text`,
      })
      .where(eq(statAwardSet.seasonId, input.seasonId))
      .returning({ seasonId: statAwardSet.seasonId });
    if (!updated) return err("not_computed");
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "stat_awards.note",
      entityType: "season",
      entityId: input.seasonId,
      after: { award: input.award, note: input.note },
    });
    return ok(undefined);
  });
}

export type ShownPlace = {
  award: StatAward;
  userId: UserId;
  name: string;
  teamName: string | null;
  teamSlug: string | null;
  place: number;
  value: number;
  detail: StatAwardDetail;
};

export type AwardsBoard = {
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  timeZone: string;
  weights: MvpWeights;
  unusedParts: MvpPart[];
  votesCounted: boolean;
  notes: Partial<Record<StatAward, string>>;
  computedAt: Date;
  publishedAt: Date | null;
  places: ShownPlace[];
};

/**
 * A season's saved awards with names, for the admin page (draft or
 * published) or the public page (`publishedOnly`). Players who have opted
 * out since are left off either way.
 */
export async function awardsBoard(
  db: Db,
  where: { seasonId: SeasonId } | { seasonSlug: string },
  options: { publishedOnly: boolean },
): Promise<
  | { found: false }
  | { found: true; seasonId: SeasonId; board: AwardsBoard | null }
> {
  const [s] = await db
    .select({
      id: season.id,
      name: season.name,
      slug: season.slug,
      timeZone: league.timezone,
      set: statAwardSet,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .leftJoin(statAwardSet, eq(statAwardSet.seasonId, season.id))
    .where(
      "seasonId" in where
        ? eq(season.id, where.seasonId)
        : eq(season.slug, where.seasonSlug),
    )
    .orderBy(desc(season.startsOn))
    .limit(1);
  if (!s) return { found: false };
  const set = s.set;
  if (!set || (options.publishedOnly && !set.publishedAt))
    return { found: true, seasonId: s.id, board: null };
  const rows = await db
    .select({
      award: statAwardPlace.award,
      userId: statAwardPlace.userId,
      firstName: profile.firstName,
      lastInitial: sql<string | null>`left(${profile.lastName}, 1)`,
      teamName: team.name,
      teamSlug: team.slug,
      place: statAwardPlace.place,
      value: statAwardPlace.value,
      detail: statAwardPlace.detail,
      optedOut: sql<boolean>`${leaderboardOptOut.userId} is not null`,
    })
    .from(statAwardPlace)
    .innerJoin(profile, eq(statAwardPlace.userId, profile.userId))
    .leftJoin(teamSeason, eq(statAwardPlace.teamSeasonId, teamSeason.id))
    .leftJoin(team, eq(teamSeason.teamId, team.id))
    .leftJoin(
      leaderboardOptOut,
      eq(leaderboardOptOut.userId, statAwardPlace.userId),
    )
    .where(eq(statAwardPlace.seasonId, s.id))
    .orderBy(
      asc(statAwardPlace.award),
      asc(statAwardPlace.place),
      asc(profile.firstName),
    );
  return {
    found: true,
    seasonId: s.id,
    board: {
      seasonId: s.id,
      seasonName: s.name,
      seasonSlug: s.slug,
      timeZone: s.timeZone,
      weights: set.weights,
      unusedParts: set.unusedParts,
      votesCounted: set.votesCounted,
      notes: set.notes,
      computedAt: set.computedAt,
      publishedAt: set.publishedAt,
      places: rows.flatMap((r) =>
        r.firstName && !r.optedOut
          ? [
              {
                award: r.award,
                userId: r.userId,
                name: shortName(r.firstName, r.lastInitial),
                teamName: r.teamName,
                teamSlug: r.teamSlug,
                place: r.place,
                value: r.value,
                detail: r.detail,
              },
            ]
          : [],
      ),
    },
  };
}

/**
 * A column for roster queries: the stat awards a player won that season,
 * once published, unless they opted out of leaderboards since.
 */
export const publishedStatAwards = (
  userId: AnyColumn,
  seasonId: AnyColumn,
) => sql<StatAward[]>`coalesce((
    select array_agg(p.award::text order by p.award)
    from ${statAwardPlace} p
    join ${statAwardSet} s on s.season_id = p.season_id
    where p.user_id = ${userId}
      and p.season_id = ${seasonId}
      and p.place = 1
      and s.published_at is not null
      and not exists (
        select 1 from ${leaderboardOptOut} o where o.user_id = p.user_id
      )
  ), '{}')`;

/** Slugs of seasons with published awards, for the sitemap and the build. */
export async function publishedAwardSeasons(
  db: Db,
): Promise<{ slug: string; publishedAt: Date }[]> {
  const rows = await db
    .select({ slug: season.slug, publishedAt: statAwardSet.publishedAt })
    .from(statAwardSet)
    .innerJoin(season, eq(statAwardSet.seasonId, season.id))
    .where(isNotNull(statAwardSet.publishedAt))
    .orderBy(desc(season.startsOn));
  return rows.flatMap((r) =>
    r.publishedAt ? [{ slug: r.slug, publishedAt: r.publishedAt }] : [],
  );
}

/**
 * Stat leaders each season poll can suggest, in one query: the draft or
 * published places of the award matching the poll's category (SUGGESTS_FOR),
 * best first, leaving out anyone who opted out of leaderboards. Weekly
 * polls get none.
 */
export async function suggestedNominees(
  db: Db,
  polls: readonly {
    id: string;
    seasonId: SeasonId;
    kind: string;
    category: string;
  }[],
): Promise<Map<string, UserId[]>> {
  const out = new Map<string, UserId[]>();
  const wanted = polls.flatMap((p) => {
    const award = p.kind === "season" ? SUGGESTS_FOR[p.category] : undefined;
    return award ? [{ ...p, award }] : [];
  });
  if (wanted.length === 0) return out;
  const rows = await db
    .select({
      seasonId: statAwardPlace.seasonId,
      award: statAwardPlace.award,
      userId: statAwardPlace.userId,
    })
    .from(statAwardPlace)
    .leftJoin(
      leaderboardOptOut,
      eq(leaderboardOptOut.userId, statAwardPlace.userId),
    )
    .where(
      and(
        inArray(statAwardPlace.seasonId, [
          ...new Set(wanted.map((w) => w.seasonId)),
        ]),
        inArray(statAwardPlace.award, [...new Set(wanted.map((w) => w.award))]),
        sql`${leaderboardOptOut.userId} is null`,
      ),
    )
    .orderBy(asc(statAwardPlace.place), asc(statAwardPlace.userId));
  for (const w of wanted)
    out.set(
      w.id,
      rows
        .filter((r) => r.seasonId === w.seasonId && r.award === w.award)
        .map((r) => r.userId),
    );
  return out;
}

export type MyAward = {
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  award: StatAward;
  value: number;
};

/** The published stat awards a person won, newest season first. */
export async function awardsWonBy(db: Db, userId: UserId): Promise<MyAward[]> {
  return db
    .select({
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      award: statAwardPlace.award,
      value: statAwardPlace.value,
    })
    .from(statAwardPlace)
    .innerJoin(statAwardSet, eq(statAwardPlace.seasonId, statAwardSet.seasonId))
    .innerJoin(season, eq(statAwardPlace.seasonId, season.id))
    .where(
      and(
        eq(statAwardPlace.userId, userId),
        eq(statAwardPlace.place, 1),
        isNotNull(statAwardSet.publishedAt),
      ),
    )
    .orderBy(desc(season.startsOn), asc(statAwardPlace.award));
}

/**
 * How many award polls a person won, by season: closed polls where they
 * had the most votes (ties share the win).
 */
export async function pollWinsBy(
  db: Db,
  userId: UserId,
): Promise<Map<SeasonId, number>> {
  // Every closed poll the person got a vote in, with all its totals.
  const theirs = db
    .select({ id: awardVote.awardPollId })
    .from(awardVote)
    .where(eq(awardVote.nomineeUserId, userId));
  const totals = await db
    .select({
      pollId: awardVote.awardPollId,
      seasonId: awardPoll.seasonId,
      nominee: awardVote.nomineeUserId,
      votes: count(),
    })
    .from(awardVote)
    .innerJoin(awardPoll, eq(awardVote.awardPollId, awardPoll.id))
    .where(
      and(
        inArray(awardVote.awardPollId, theirs),
        lte(awardPoll.closesAt, sql`now()`),
        isNotNull(awardVote.nomineeUserId),
      ),
    )
    .groupBy(
      awardVote.awardPollId,
      awardPoll.seasonId,
      awardVote.nomineeUserId,
    );
  const wins = new Map<SeasonId, number>();
  for (const pollId of new Set(totals.map((t) => t.pollId))) {
    const poll = totals.filter((t) => t.pollId === pollId);
    const top = Math.max(...poll.map((t) => t.votes));
    const mine = poll.find((t) => t.nominee === userId);
    if (mine && mine.votes === top)
      wins.set(mine.seasonId, (wins.get(mine.seasonId) ?? 0) + 1);
  }
  return wins;
}

export type MySeason = {
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  teamName: string;
  startsOn: string;
};

/** The seasons a person played on a roster, newest first. */
export async function seasonsPlayedBy(
  db: Db,
  userId: UserId,
): Promise<MySeason[]> {
  return db
    .select({
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      teamName: team.name,
      startsOn: season.startsOn,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(season, eq(registration.seasonId, season.id))
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
        lt(season.startsOn, sql`current_date + 1`),
      ),
    )
    .orderBy(desc(season.startsOn));
}

/** Whether a person asked to stay off public leaderboards. */
export async function isOptedOut(db: Db, userId: UserId): Promise<boolean> {
  const [row] = await db
    .select({ userId: leaderboardOptOut.userId })
    .from(leaderboardOptOut)
    .where(eq(leaderboardOptOut.userId, userId));
  return row !== undefined;
}

/**
 * Opts a person out of public leaderboards, or back in. Returns the
 * seasons whose published awards listed them, so their pages refresh.
 */
export async function setLeaderboardOptOut(
  db: Db,
  userId: UserId,
  optOut: boolean,
): Promise<SeasonId[]> {
  if (optOut)
    await db.insert(leaderboardOptOut).values({ userId }).onConflictDoNothing();
  else
    await db
      .delete(leaderboardOptOut)
      .where(eq(leaderboardOptOut.userId, userId));
  const rows = await db
    .selectDistinct({ seasonId: statAwardPlace.seasonId })
    .from(statAwardPlace)
    .where(eq(statAwardPlace.userId, userId));
  return rows.map((r) => r.seasonId);
}

/** A season's saved weights, or null before the first computation. */
export async function savedWeights(
  db: Db,
  seasonId: SeasonId,
): Promise<MvpWeights | null> {
  const [row] = await db
    .select({ weights: statAwardSet.weights })
    .from(statAwardSet)
    .where(eq(statAwardSet.seasonId, seasonId));
  return row?.weights ?? null;
}

/** For a person's own data export: their stat award places and opt-out. */
export async function myStatAwards(db: Db, userId: UserId) {
  const [places, hidden] = await Promise.all([
    db
      .select({
        season: season.name,
        award: statAwardPlace.award,
        place: statAwardPlace.place,
        value: statAwardPlace.value,
        published: sql<boolean>`${statAwardSet.publishedAt} is not null`,
      })
      .from(statAwardPlace)
      .innerJoin(
        statAwardSet,
        eq(statAwardPlace.seasonId, statAwardSet.seasonId),
      )
      .innerJoin(season, eq(statAwardPlace.seasonId, season.id))
      .where(eq(statAwardPlace.userId, userId))
      .orderBy(desc(season.startsOn), asc(statAwardPlace.award)),
    isOptedOut(db, userId),
  ]);
  return { statAwardPlaces: places, offLeaderboards: hidden };
}

/** For account deletion: the person's award places and opt-out. */
export async function removeStatAwardsOf(db: Db, userId: UserId) {
  await db.delete(statAwardPlace).where(eq(statAwardPlace.userId, userId));
  await db
    .delete(leaderboardOptOut)
    .where(eq(leaderboardOptOut.userId, userId));
}
