import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  CATEGORIES,
  type Category,
  checkVote,
  type NewPoll,
  type Nominee,
  type PollKind,
  pollState,
  type PollState,
  tally,
  type TallyRow,
  type VoteError,
} from "@/domain/awards/awards";
import type { AwardPollId, SeasonId, TeamSeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { awardPoll, awardVote } from "../schema/awards";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Awards voting (product-spec.md, "Awards voting"; docs/data-model.md,
 * section 2.5). Admins open polls; players on a roster that season vote
 * once; totals are read only after a poll closes, so nobody sees a running
 * count. Who voted for whom is never returned to anyone but the voter.
 */

export type Poll = {
  id: AwardPollId;
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  timeZone: string;
  kind: PollKind;
  category: Category;
  title: string;
  gameDay: string | null;
  opensAt: Date;
  closesAt: Date;
};

const pollColumns = {
  id: awardPoll.id,
  seasonId: awardPoll.seasonId,
  seasonName: season.name,
  seasonSlug: season.slug,
  timeZone: league.timezone,
  kind: awardPoll.kind,
  category: awardPoll.category,
  title: awardPoll.title,
  gameDay: awardPoll.gameDay,
  opensAt: awardPoll.opensAt,
  closesAt: awardPoll.closesAt,
};

const polls = (db: Db) =>
  db
    .select(pollColumns)
    .from(awardPoll)
    .innerJoin(season, eq(awardPoll.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id));

export async function pollById(db: Db, id: AwardPollId): Promise<Poll | null> {
  const [found] = await polls(db).where(eq(awardPoll.id, id));
  return found ?? null;
}

/** A slot's start as a date on the league's wall clock. */
const localDay = sql<string>`to_char(${slot.startsAt} at time zone ${league.timezone}, 'YYYY-MM-DD')`;

/** Games that were or will be played: scheduled on a field, not called off. */
const playedGame = and(
  isNotNull(game.slotId),
  notInArray(game.status, ["cancelled", "postponed"]),
);

/** The season's game days, as local dates, in order. */
export async function gameDaysOf(db: Db, seasonId: SeasonId) {
  const rows = await db
    .selectDistinct({ day: localDay })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(and(eq(game.seasonId, seasonId), playedGame))
    .orderBy(localDay);
  return rows.map((r) => r.day);
}

const shortName = (first: string, lastInitial: string | null) =>
  lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;

/**
 * Each poll's ballot, in three queries however many polls there are: the
 * seasons' teams, their active players with a first name, and which teams
 * played on each weekly poll's game day. A weekly ballot lists only those
 * teams (or their players); a season ballot lists everyone.
 */
export async function ballotsFor(
  db: Db,
  forPolls: readonly Poll[],
): Promise<Map<AwardPollId, Nominee[]>> {
  const ballots = new Map<AwardPollId, Nominee[]>();
  if (forPolls.length === 0) return ballots;
  const seasonIds = [...new Set(forPolls.map((p) => p.seasonId))];
  const days = [
    ...new Set(forPolls.flatMap((p) => (p.gameDay ? [p.gameDay] : []))),
  ];
  const wantsPlayers = forPolls.some(
    (p) => CATEGORIES[p.category].nominee === "player",
  );
  const [teams, players, played] = await Promise.all([
    db
      .select({
        id: teamSeason.id,
        seasonId: teamSeason.seasonId,
        name: team.name,
      })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(
        and(
          inArray(teamSeason.seasonId, seasonIds),
          ne(teamSeason.status, "withdrawn"),
        ),
      )
      .orderBy(asc(team.name)),
    wantsPlayers
      ? db
          .select({
            userId: registration.userId,
            teamSeasonId: rosterMembership.teamSeasonId,
            firstName: profile.firstName,
            lastInitial: sql<string | null>`left(${profile.lastName}, 1)`,
          })
          .from(rosterMembership)
          .innerJoin(
            registration,
            eq(rosterMembership.registrationId, registration.id),
          )
          .innerJoin(profile, eq(registration.userId, profile.userId))
          .where(
            and(
              inArray(registration.seasonId, seasonIds),
              eq(rosterMembership.status, "active"),
              isNotNull(profile.firstName),
            ),
          )
          .orderBy(asc(profile.firstName), asc(profile.lastName))
      : Promise.resolve([]),
    days.length > 0
      ? db
          .select({
            seasonId: game.seasonId,
            day: localDay,
            teamAId: game.teamAId,
            teamBId: game.teamBId,
          })
          .from(game)
          .innerJoin(slot, eq(game.slotId, slot.id))
          .innerJoin(season, eq(game.seasonId, season.id))
          .innerJoin(league, eq(season.leagueId, league.id))
          .where(
            and(
              inArray(game.seasonId, seasonIds),
              playedGame,
              inArray(localDay, days),
            ),
          )
      : Promise.resolve([]),
  ]);

  for (const poll of forPolls) {
    const playedThatDay = new Set(
      played
        .filter((g) => g.seasonId === poll.seasonId && g.day === poll.gameDay)
        .flatMap((g) => [g.teamAId, g.teamBId]),
    );
    const eligible = teams.filter(
      (t) =>
        t.seasonId === poll.seasonId &&
        (poll.kind === "season" || playedThatDay.has(t.id)),
    );
    const teamName = new Map(eligible.map((t) => [t.id, t.name]));
    const nominees: Nominee[] =
      CATEGORIES[poll.category].nominee === "team"
        ? eligible.map((t) => ({
            id: t.id,
            kind: "team",
            name: t.name,
            teamSeasonId: t.id,
            teamName: t.name,
          }))
        : players.flatMap((p) => {
            const name = teamName.get(p.teamSeasonId);
            return name && p.firstName
              ? [
                  {
                    id: p.userId,
                    kind: "player" as const,
                    name: shortName(p.firstName, p.lastInitial),
                    teamSeasonId: p.teamSeasonId,
                    teamName: name,
                  },
                ]
              : [];
          });
    ballots.set(poll.id, nominees);
  }
  return ballots;
}

/** The team a person plays for this season, or null if not on a roster. */
async function rosterTeam(
  db: Db,
  userId: UserId,
  seasonId: SeasonId,
): Promise<TeamSeasonId | null> {
  const [row] = await db
    .select({ teamSeasonId: rosterMembership.teamSeasonId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, userId),
        eq(registration.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
      ),
    );
  return row?.teamSeasonId ?? null;
}

/** Seasons where a person is on a roster, with their team. */
function myRosters(db: Db, userId: UserId) {
  return db
    .select({
      seasonId: registration.seasonId,
      teamSeasonId: rosterMembership.teamSeasonId,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
      ),
    );
}

export type CastError = VoteError | "not_found";

/**
 * Casts a player's one vote in a poll. The unique (poll, voter) constraint
 * decides between two votes sent at once: the second inserts nothing and
 * reads as already voted.
 */
export async function castVote(
  db: Db,
  input: {
    pollId: AwardPollId;
    voterId: UserId;
    nomineeId: string;
    now: Date;
  },
): Promise<Result<Nominee, CastError>> {
  const poll = await pollById(db, input.pollId);
  if (!poll) return err("not_found");
  const [teamSeasonId, ballot] = await Promise.all([
    rosterTeam(db, input.voterId, poll.seasonId),
    ballotsFor(db, [poll]).then((b) => b.get(poll.id) ?? []),
  ]);
  const checked = checkVote({
    poll,
    now: input.now,
    voter: { userId: input.voterId, teamSeasonId },
    nomineeId: input.nomineeId,
    ballot,
  });
  if (!checked.ok) return checked;
  const pick = checked.value;
  const [cast] = await db
    .insert(awardVote)
    .values({
      awardPollId: poll.id,
      voterId: input.voterId,
      nomineeUserId: pick.kind === "player" ? (pick.id as UserId) : null,
      nomineeTeamSeasonId:
        pick.kind === "team" ? (pick.id as TeamSeasonId) : null,
      castAt: input.now,
    })
    .onConflictDoNothing({
      target: [awardVote.awardPollId, awardVote.voterId],
    })
    .returning({ id: awardVote.id });
  return cast ? ok(pick) : err("already_voted");
}

export type Ballot = {
  poll: Poll;
  nominees: Nominee[];
  /** The voter's team that season, left off a team award's ballot. */
  myTeamSeasonId: TeamSeasonId;
  /** Who this person voted for, shown only to them. */
  myVote: string | null;
};

/**
 * The voting page: open polls in the seasons this person plays in, with
 * their ballot and their own vote, and the most recently closed polls.
 */
export async function votingPage(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<{ onRoster: boolean; ballots: Ballot[]; closed: Poll[] }> {
  const [rosters, closed] = await Promise.all([
    myRosters(db, userId),
    polls(db)
      .where(lte(awardPoll.closesAt, now))
      .orderBy(desc(awardPoll.closesAt), asc(awardPoll.title))
      .limit(20),
  ]);
  const seasonIds = rosters.map((r) => r.seasonId);
  if (seasonIds.length === 0) return { onRoster: false, ballots: [], closed };
  const open = await polls(db)
    .where(
      and(
        inArray(awardPoll.seasonId, seasonIds),
        lte(awardPoll.opensAt, now),
        gt(awardPoll.closesAt, now),
      ),
    )
    .orderBy(asc(awardPoll.closesAt), asc(awardPoll.title));
  const [ballots, mine] = await Promise.all([
    ballotsFor(db, open),
    open.length > 0
      ? db
          .select({
            pollId: awardVote.awardPollId,
            userId: awardVote.nomineeUserId,
            teamSeasonId: awardVote.nomineeTeamSeasonId,
          })
          .from(awardVote)
          .where(
            and(
              eq(awardVote.voterId, userId),
              inArray(
                awardVote.awardPollId,
                open.map((p) => p.id),
              ),
            ),
          )
      : Promise.resolve([]),
  ]);
  return {
    onRoster: true,
    ballots: open.map((poll) => {
      const vote = mine.find((v) => v.pollId === poll.id);
      return {
        poll,
        nominees: ballots.get(poll.id) ?? [],
        myTeamSeasonId: required(
          rosters.find((r) => r.seasonId === poll.seasonId),
          "roster",
        ).teamSeasonId,
        myVote: vote ? (vote.userId ?? vote.teamSeasonId) : null,
      };
    }),
    closed,
  };
}

/** How many open polls this person can still vote in, for the home screen. */
export async function ballotsWaiting(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<number> {
  const mySeasons = db
    .select({ seasonId: registration.seasonId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
      ),
    );
  const [row] = await db
    .select({ n: count() })
    .from(awardPoll)
    .where(
      and(
        inArray(awardPoll.seasonId, mySeasons),
        lte(awardPoll.opensAt, now),
        gt(awardPoll.closesAt, now),
        notExists(
          db
            .select({ id: awardVote.id })
            .from(awardVote)
            .where(
              and(
                eq(awardVote.awardPollId, awardPoll.id),
                eq(awardVote.voterId, userId),
              ),
            ),
        ),
      ),
    );
  return row?.n ?? 0;
}

export type ResultRow = TallyRow & {
  name: string;
  /** A player's team; null for a team award. */
  teamName: string | null;
};

/**
 * A poll and, once it has closed, its totals. Before then `results` is
 * null: nobody, admins included, sees a running count.
 */
export async function pollResults(
  db: Db,
  pollId: AwardPollId,
  now: Date,
): Promise<{
  poll: Poll;
  state: PollState;
  results: { rows: ResultRow[]; winners: ResultRow[]; total: number } | null;
} | null> {
  const poll = await pollById(db, pollId);
  if (!poll) return null;
  const state = pollState(poll, now);
  if (state !== "closed") return { poll, state, results: null };
  const [counts, ballot] = await Promise.all([
    db
      .select({
        userId: awardVote.nomineeUserId,
        teamSeasonId: awardVote.nomineeTeamSeasonId,
        votes: count(),
      })
      .from(awardVote)
      .where(eq(awardVote.awardPollId, poll.id))
      .groupBy(awardVote.nomineeUserId, awardVote.nomineeTeamSeasonId),
    ballotsFor(db, [poll]).then((b) => b.get(poll.id) ?? []),
  ]);
  const counted = tally(
    counts.map((c) => ({
      nomineeId: required(c.userId ?? c.teamSeasonId, "nominee"),
      votes: c.votes,
    })),
  );
  // A nominee who has since left the roster is missing from today's ballot.
  const missing = counted.rows
    .map((r) => r.nomineeId)
    .filter((id) => !ballot.some((n) => n.id === id));
  const former = missing.length
    ? await namesOf(db, poll, missing)
    : new Map<string, string>();
  const named = (r: TallyRow): ResultRow => {
    const n = ballot.find((x) => x.id === r.nomineeId);
    return {
      ...r,
      name: n?.name ?? former.get(r.nomineeId) ?? "A former player",
      teamName: n && n.kind === "player" ? n.teamName : null,
    };
  };
  const rows = counted.rows.map(named);
  return {
    poll,
    state,
    results: {
      rows,
      winners: rows.filter((r) => counted.winners.includes(r.nomineeId)),
      total: counted.total,
    },
  };
}

/** Names for nominees no longer on the ballot. */
async function namesOf(
  db: Db,
  poll: Poll,
  ids: string[],
): Promise<Map<string, string>> {
  if (CATEGORIES[poll.category].nominee === "team") {
    const rows = await db
      .select({ id: teamSeason.id, name: team.name })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(inArray(teamSeason.id, ids as TeamSeasonId[]));
    return new Map(rows.map((r) => [r.id as string, r.name]));
  }
  const rows = await db
    .select({
      id: profile.userId,
      firstName: profile.firstName,
      lastInitial: sql<string | null>`left(${profile.lastName}, 1)`,
    })
    .from(profile)
    .where(inArray(profile.userId, ids as UserId[]));
  return new Map(
    rows.flatMap((r) =>
      r.firstName
        ? [[r.id as string, shortName(r.firstName, r.lastInitial)]]
        : [],
    ),
  );
}

/** Every poll of a season for the admin page, newest closing first. */
export async function seasonPolls(db: Db, seasonId: SeasonId) {
  return polls(db)
    .where(eq(awardPoll.seasonId, seasonId))
    .orderBy(desc(awardPoll.closesAt), asc(awardPoll.title));
}

/** Opens a poll; the audit row names it. */
export async function openPoll(
  db: Db,
  input: { seasonId: SeasonId; poll: NewPoll; actorId: UserId },
): Promise<AwardPollId> {
  return db.transaction(async (tx) => {
    const created = required(
      (
        await tx
          .insert(awardPoll)
          .values({
            seasonId: input.seasonId,
            kind: input.poll.kind,
            category: input.poll.category,
            title: input.poll.title,
            gameDay: input.poll.gameDay,
            opensAt: input.poll.opensAt,
            closesAt: input.poll.closesAt,
            createdBy: input.actorId,
          })
          .returning({ id: awardPoll.id })
      )[0],
      "award poll",
    );
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "awards.open",
      entityType: "award_poll",
      entityId: created.id,
      after: {
        title: input.poll.title,
        closesAt: input.poll.closesAt.toISOString(),
      },
    });
    return created.id;
  });
}

/** Ends voting now, so the results show. Only an open poll can close early. */
export async function closePollNow(
  db: Db,
  input: {
    pollId: AwardPollId;
    seasonId: SeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_found" | "not_open">> {
  return db.transaction(async (tx) => {
    const [poll] = await tx
      .select({ opensAt: awardPoll.opensAt, closesAt: awardPoll.closesAt })
      .from(awardPoll)
      .where(
        and(
          eq(awardPoll.id, input.pollId),
          eq(awardPoll.seasonId, input.seasonId),
        ),
      )
      .for("update");
    if (!poll) return err("not_found");
    if (pollState(poll, input.now) !== "open") return err("not_open");
    await tx
      .update(awardPoll)
      .set({ closesAt: input.now })
      .where(eq(awardPoll.id, input.pollId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "awards.close",
      entityType: "award_poll",
      entityId: input.pollId,
      before: { closesAt: poll.closesAt.toISOString() },
      after: { closesAt: input.now.toISOString() },
    });
    return ok(undefined);
  });
}

/** Removes a poll and its votes. */
export async function removePoll(
  db: Db,
  input: { pollId: AwardPollId; seasonId: SeasonId; actorId: UserId },
): Promise<Result<void, "not_found">> {
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(awardPoll)
      .where(
        and(
          eq(awardPoll.id, input.pollId),
          eq(awardPoll.seasonId, input.seasonId),
        ),
      )
      .returning({ title: awardPoll.title });
    if (!gone) return err("not_found");
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "awards.remove",
      entityType: "award_poll",
      entityId: input.pollId,
      before: { title: gone.title },
    });
    return ok(undefined);
  });
}
