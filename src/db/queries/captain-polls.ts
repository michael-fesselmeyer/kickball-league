import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  ne,
} from "drizzle-orm";
import {
  canSeeResults,
  checkVote,
  type NewCaptainPoll,
  type OptionRow,
  optionResults,
  pollState,
  type PollState,
  REMIND_WITHIN_MS,
  type ResultsVisibility,
  teamList,
  type VoteError,
  type VoterRole,
} from "@/domain/captain-polls/captain-polls";
import type {
  CaptainPollId,
  CaptainPollOptionId,
  LeagueId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  captainPoll,
  captainPollOption,
  captainPollVote,
} from "../schema/captain-poll";
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
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Quick polls for captains (ADR 0063; docs/data-model.md, section 2.5). An
 * admin asks a season's captains one question; each team that is still
 * playing gets one vote, cast by its captain or, when the poll includes
 * them, a co-captain. A vote is one row per (poll, team), so changing it
 * overwrites it and the last answer from either captain wins. The
 * electorate is read when it is needed, not copied at opening, so a team
 * added or a captain changed after the poll opens is counted as it stands.
 */

export type CaptainPollRow = {
  id: CaptainPollId;
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  timeZone: string;
  title: string;
  detail: string;
  includeCoCaptains: boolean;
  results: ResultsVisibility;
  opensAt: Date;
  closesAt: Date;
};

const pollColumns = {
  id: captainPoll.id,
  seasonId: captainPoll.seasonId,
  seasonName: season.name,
  seasonSlug: season.slug,
  timeZone: league.timezone,
  title: captainPoll.title,
  detail: captainPoll.detail,
  includeCoCaptains: captainPoll.includeCoCaptains,
  results: captainPoll.results,
  opensAt: captainPoll.opensAt,
  closesAt: captainPoll.closesAt,
};

const polls = (db: Db) =>
  db
    .select(pollColumns)
    .from(captainPoll)
    .innerJoin(season, eq(captainPoll.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id));

export async function pollById(
  db: Db,
  id: CaptainPollId,
): Promise<CaptainPollRow | null> {
  const [found] = await polls(db).where(eq(captainPoll.id, id));
  return found ?? null;
}

const optionsOf = (db: Db, pollIds: readonly CaptainPollId[]) =>
  pollIds.length === 0
    ? Promise.resolve([])
    : db
        .select({
          id: captainPollOption.id,
          pollId: captainPollOption.captainPollId,
          position: captainPollOption.position,
          label: captainPollOption.label,
        })
        .from(captainPollOption)
        .where(inArray(captainPollOption.captainPollId, [...pollIds]))
        .orderBy(asc(captainPollOption.position));

/** The teams still playing in a season. */
const liveTeams = (db: Db, seasonId: SeasonId) =>
  db
    .select({ id: teamSeason.id, name: team.name })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(eq(teamSeason.seasonId, seasonId), ne(teamSeason.status, "withdrawn")),
    )
    .orderBy(asc(team.name));

type Voter = {
  userId: UserId;
  teamSeasonId: TeamSeasonId;
  teamName: string;
  role: VoterRole;
  firstName: string | null;
};

/**
 * Everyone who may vote for a team in a season's polls: active captains
 * and, when asked, co-captains of teams that are still playing.
 */
async function votersOf(
  db: Db,
  seasonId: SeasonId,
  includeCoCaptains: boolean,
): Promise<Voter[]> {
  const rows = await db
    .select({
      userId: registration.userId,
      teamSeasonId: rosterMembership.teamSeasonId,
      teamName: team.name,
      role: rosterMembership.role,
      firstName: profile.firstName,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        ne(teamSeason.status, "withdrawn"),
        eq(rosterMembership.status, "active"),
        inArray(
          rosterMembership.role,
          includeCoCaptains ? ["captain", "co_captain"] : ["captain"],
        ),
      ),
    )
    .orderBy(asc(team.name));
  return rows.flatMap((r) =>
    r.role === "captain" || r.role === "co_captain"
      ? [{ ...r, role: r.role }]
      : [],
  );
}

const queueFor = (
  poll: Pick<
    CaptainPollRow,
    "id" | "title" | "seasonName" | "closesAt" | "timeZone"
  >,
  voters: readonly Voter[],
  kind: "new" | "reminder",
  dedupe: string,
): OutboxMessage[] => {
  const closes = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: poll.timeZone,
  }).format(poll.closesAt);
  const byUser = new Map<UserId, Set<string>>();
  for (const v of voters)
    byUser.set(v.userId, (byUser.get(v.userId) ?? new Set()).add(v.teamName));
  return [...byUser].map(([userId, teams]) => ({
    userId,
    template: "captain_poll" as const,
    // Like announcements: a captain who muted those has muted these.
    topic: "announcement" as const,
    payload: {
      kind,
      question: poll.title,
      seasonName: poll.seasonName,
      teams: teamList([...teams].sort()),
      closes,
    },
    dedupeKey: `captain_poll/${poll.id}/${dedupe}/${userId}`,
  }));
};

/**
 * Opens a poll with its options and queues the invitation to every voter,
 * all in one transaction. The audit row names the question.
 */
export async function openPoll(
  db: Db,
  input: { seasonId: SeasonId; poll: NewCaptainPoll; actorId: UserId },
): Promise<CaptainPollId> {
  return db.transaction(async (tx) => {
    const created = required(
      (
        await tx
          .insert(captainPoll)
          .values({
            seasonId: input.seasonId,
            title: input.poll.title,
            detail: input.poll.detail,
            includeCoCaptains: input.poll.includeCoCaptains,
            results: input.poll.results,
            opensAt: input.poll.opensAt,
            closesAt: input.poll.closesAt,
            createdBy: input.actorId,
          })
          .returning({ id: captainPoll.id })
      )[0],
      "captain poll",
    );
    await tx.insert(captainPollOption).values(
      input.poll.options.map((label, i) => ({
        captainPollId: created.id,
        position: i + 1,
        label,
      })),
    );
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "captain_poll.open",
      entityType: "captain_poll",
      entityId: created.id,
      after: {
        title: input.poll.title,
        options: input.poll.options,
        closesAt: input.poll.closesAt.toISOString(),
      },
    });
    const [poll, voters] = await Promise.all([
      pollById(tx, created.id),
      votersOf(tx, input.seasonId, input.poll.includeCoCaptains),
    ]);
    await enqueueMessages(
      tx,
      queueFor(required(poll, "captain poll"), voters, "new", "new"),
    );
    return created.id;
  });
}

export type CastError = VoteError | "not_found";

/**
 * Records a team's vote, or changes it. The poll row is locked while it is
 * checked so a vote and an early close can't pass each other: a vote that
 * lands after the close is refused. Two captains answering at once leave
 * the later write.
 */
export async function castVote(
  db: Db,
  input: {
    pollId: CaptainPollId;
    teamSeasonId: TeamSeasonId;
    optionId: CaptainPollOptionId;
    voterId: UserId;
    now: Date;
  },
): Promise<Result<void, CastError>> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: captainPoll.id,
        seasonId: captainPoll.seasonId,
        opensAt: captainPoll.opensAt,
        closesAt: captainPoll.closesAt,
        includeCoCaptains: captainPoll.includeCoCaptains,
      })
      .from(captainPoll)
      .where(eq(captainPoll.id, input.pollId))
      .for("share");
    if (!locked) return err("not_found");
    const [options, teams, mine] = await Promise.all([
      optionsOf(tx, [locked.id]),
      liveTeams(tx, locked.seasonId),
      tx
        .select({ role: rosterMembership.role })
        .from(rosterMembership)
        .innerJoin(
          registration,
          eq(rosterMembership.registrationId, registration.id),
        )
        .where(
          and(
            eq(registration.userId, input.voterId),
            eq(rosterMembership.teamSeasonId, input.teamSeasonId),
            eq(rosterMembership.status, "active"),
          ),
        ),
    ]);
    const role = mine.find((m) => m.role === "captain")
      ? "captain"
      : mine.find((m) => m.role === "co_captain")
        ? "co_captain"
        : null;
    const checked = checkVote({
      poll: locked,
      now: input.now,
      role,
      teamInPoll: teams.some((t) => t.id === input.teamSeasonId),
      optionId: input.optionId,
      optionIds: options.map((o) => o.id),
    });
    if (!checked.ok) return checked;
    await tx
      .insert(captainPollVote)
      .values({
        captainPollId: locked.id,
        teamSeasonId: input.teamSeasonId,
        optionId: input.optionId,
        voterId: input.voterId,
        castAt: input.now,
      })
      .onConflictDoUpdate({
        target: [captainPollVote.captainPollId, captainPollVote.teamSeasonId],
        set: {
          optionId: input.optionId,
          voterId: input.voterId,
          castAt: input.now,
        },
      });
    return ok(undefined);
  });
}

export type TeamVote = {
  teamSeasonId: TeamSeasonId;
  teamName: string;
  optionId: CaptainPollOptionId | null;
  /** First name of the captain who cast or last changed it. */
  voterName: string | null;
  castAt: Date | null;
};

export type AdminPoll = {
  poll: CaptainPollRow;
  state: PollState;
  options: OptionRow[];
  winners: CaptainPollOptionId[];
  teams: TeamVote[];
  voted: number;
};

/** A poll for its admin: live totals and each team's answer. */
export async function adminPoll(
  db: Db,
  pollId: CaptainPollId,
  now: Date,
): Promise<AdminPoll | null> {
  const poll = await pollById(db, pollId);
  if (!poll) return null;
  const [options, teams, votes] = await Promise.all([
    optionsOf(db, [poll.id]),
    liveTeams(db, poll.seasonId),
    db
      .select({
        teamSeasonId: captainPollVote.teamSeasonId,
        optionId: captainPollVote.optionId,
        castAt: captainPollVote.castAt,
        voterName: profile.firstName,
      })
      .from(captainPollVote)
      .leftJoin(profile, eq(profile.userId, captainPollVote.voterId))
      .where(eq(captainPollVote.captainPollId, poll.id)),
  ]);
  const byTeam = new Map(votes.map((v) => [v.teamSeasonId, v]));
  const rows: TeamVote[] = teams.map((t) => {
    const v = byTeam.get(t.id);
    return {
      teamSeasonId: t.id,
      teamName: t.name,
      optionId: v?.optionId ?? null,
      voterName: v?.voterName ?? null,
      castAt: v?.castAt ?? null,
    };
  });
  // A team that withdrew after voting no longer counts toward the totals.
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.optionId) counts.set(r.optionId, (counts.get(r.optionId) ?? 0) + 1);
  const results = optionResults(options, counts);
  return {
    poll,
    state: pollState(poll, now),
    options: results.rows,
    winners: results.winners as CaptainPollOptionId[],
    teams: rows,
    voted: rows.filter((r) => r.optionId).length,
  };
}

export type SeasonPoll = CaptainPollRow & {
  state: PollState;
  teams: number;
  voted: number;
};

/** A season's polls for the admin list, newest closing first. */
export async function seasonPolls(
  db: Db,
  seasonId: SeasonId,
  now: Date,
): Promise<SeasonPoll[]> {
  const [rows, teams, votes] = await Promise.all([
    polls(db)
      .where(eq(captainPoll.seasonId, seasonId))
      .orderBy(desc(captainPoll.closesAt), asc(captainPoll.title)),
    liveTeams(db, seasonId),
    db
      .select({
        pollId: captainPollVote.captainPollId,
        teamSeasonId: captainPollVote.teamSeasonId,
      })
      .from(captainPollVote)
      .innerJoin(captainPoll, eq(captainPoll.id, captainPollVote.captainPollId))
      .where(eq(captainPoll.seasonId, seasonId)),
  ]);
  const live = new Set<string>(teams.map((t) => t.id));
  return rows.map((p) => ({
    ...p,
    state: pollState(p, now),
    teams: teams.length,
    voted: votes.filter((v) => v.pollId === p.id && live.has(v.teamSeasonId))
      .length,
  }));
}

/** Ends voting now. Only an open poll can close early. */
export async function closePollNow(
  db: Db,
  input: {
    pollId: CaptainPollId;
    seasonId: SeasonId;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_found" | "not_open">> {
  return db.transaction(async (tx) => {
    const [poll] = await tx
      .select({ opensAt: captainPoll.opensAt, closesAt: captainPoll.closesAt })
      .from(captainPoll)
      .where(
        and(
          eq(captainPoll.id, input.pollId),
          eq(captainPoll.seasonId, input.seasonId),
        ),
      )
      .for("update");
    if (!poll) return err("not_found");
    if (pollState(poll, input.now) !== "open") return err("not_open");
    await tx
      .update(captainPoll)
      .set({ closesAt: input.now })
      .where(eq(captainPoll.id, input.pollId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "captain_poll.close",
      entityType: "captain_poll",
      entityId: input.pollId,
      before: { closesAt: poll.closesAt.toISOString() },
      after: { closesAt: input.now.toISOString() },
    });
    return ok(undefined);
  });
}

/** Removes a poll, its options and every vote. */
export async function removePoll(
  db: Db,
  input: { pollId: CaptainPollId; seasonId: SeasonId; actorId: UserId },
): Promise<Result<void, "not_found">> {
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(captainPoll)
      .where(
        and(
          eq(captainPoll.id, input.pollId),
          eq(captainPoll.seasonId, input.seasonId),
        ),
      )
      .returning({ title: captainPoll.title });
    if (!gone) return err("not_found");
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "captain_poll.remove",
      entityType: "captain_poll",
      leagueFrom: { kind: "season", id: input.seasonId },
      entityId: input.pollId,
      before: { title: gone.title },
    });
    return ok(undefined);
  });
}

export type CaptainTeam = {
  teamSeasonId: TeamSeasonId;
  teamName: string;
  myOptionId: CaptainPollOptionId | null;
  /** The team's vote was last changed by another captain. */
  changedByOther: boolean;
};

export type CaptainBallot = {
  poll: CaptainPollRow;
  state: PollState;
  options: { id: CaptainPollOptionId; label: string }[];
  /** The teams this person answers for. */
  teams: CaptainTeam[];
  /** Totals, once this person may see them; null before. */
  results: { rows: OptionRow[]; winners: string[]; total: number } | null;
};

/** A closed poll stays on a captain's page this long. */
const CLOSED_KEPT_MS = 14 * 86_400_000;

/**
 * The captain's page: polls that are open, or closed within two weeks, in
 * the seasons where this person is a captain (or a co-captain, for polls
 * that include them), with each of their teams' answers and the totals
 * when they may see them.
 */
export async function captainBallots(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<CaptainBallot[]> {
  const mine = await db
    .select({
      seasonId: teamSeason.seasonId,
      teamSeasonId: teamSeason.id,
      teamName: team.name,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
        ne(teamSeason.status, "withdrawn"),
        inArray(rosterMembership.role, ["captain", "co_captain"]),
      ),
    );
  if (mine.length === 0) return [];
  const rows = await polls(db)
    .where(
      and(
        inArray(captainPoll.seasonId, [...new Set(mine.map((m) => m.seasonId))]),
        lte(captainPoll.opensAt, now),
        gte(captainPoll.closesAt, new Date(now.getTime() - CLOSED_KEPT_MS)),
      ),
    )
    .orderBy(asc(captainPoll.closesAt), asc(captainPoll.title));
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const [options, votes] = await Promise.all([
    optionsOf(db, ids),
    db
      .select({
        pollId: captainPollVote.captainPollId,
        teamSeasonId: captainPollVote.teamSeasonId,
        optionId: captainPollVote.optionId,
        voterId: captainPollVote.voterId,
      })
      .from(captainPollVote)
      .where(inArray(captainPollVote.captainPollId, ids)),
  ]);
  const seasonTeams = new Map<SeasonId, Set<string>>();
  for (const p of rows)
    if (!seasonTeams.has(p.seasonId))
      seasonTeams.set(
        p.seasonId,
        new Set((await liveTeams(db, p.seasonId)).map((t) => t.id)),
      );
  const ballots: CaptainBallot[] = [];
  for (const poll of rows) {
    const teams = mine
      .filter(
        (m) =>
          m.seasonId === poll.seasonId &&
          (m.role === "captain" || poll.includeCoCaptains),
      )
      .map((m): CaptainTeam => {
        const v = votes.find(
          (x) => x.pollId === poll.id && x.teamSeasonId === m.teamSeasonId,
        );
        return {
          teamSeasonId: m.teamSeasonId,
          teamName: m.teamName,
          myOptionId: v?.optionId ?? null,
          changedByOther: !!v && v.voterId !== userId,
        };
      })
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
    if (teams.length === 0) continue;
    const state = pollState(poll, now);
    const live = seasonTeams.get(poll.seasonId) ?? new Set<string>();
    const pollOptions = options.filter((o) => o.pollId === poll.id);
    const visible = canSeeResults({
      viewer: "captain",
      state,
      visibility: poll.results,
      teamVoted: teams.some((t) => t.myOptionId !== null),
    });
    const counts = new Map<string, number>();
    for (const v of votes)
      if (v.pollId === poll.id && live.has(v.teamSeasonId))
        counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
    ballots.push({
      poll,
      state,
      options: pollOptions.map((o) => ({ id: o.id, label: o.label })),
      teams,
      results: visible ? optionResults(pollOptions, counts) : null,
    });
  }
  return ballots;
}

/**
 * How many (poll, team) answers this person still owes in open polls, for
 * the home screen.
 */
export async function pollsWaiting(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<number> {
  const open = (await captainBallots(db, userId, now)).filter(
    (b) => b.state === "open",
  );
  return open.reduce(
    (n, b) => n + b.teams.filter((t) => t.myOptionId === null).length,
    0,
  );
}

/**
 * Reminds the captains of every team that has not voted. The daily job
 * reminds polls closing within a day; an admin's "remind now" names one
 * poll. The dedupe key holds the local date, so a captain gets at most one
 * a day per poll however the two overlap, and a team whose vote is in, or
 * that has since withdrawn, gets none. Each message counts toward the
 * person's daily cap like any non-urgent one.
 */
export async function queueReminders(
  db: Db,
  input: {
    leagueId: LeagueId;
    now: Date;
    today: string;
    pollId?: CaptainPollId;
  },
): Promise<number> {
  const open = await polls(db).where(
    and(
      eq(season.leagueId, input.leagueId),
      lte(captainPoll.opensAt, input.now),
      gt(captainPoll.closesAt, input.now),
      input.pollId
        ? eq(captainPoll.id, input.pollId)
        : lte(
            captainPoll.closesAt,
            new Date(input.now.getTime() + REMIND_WITHIN_MS),
          ),
    ),
  );
  const messages: OutboxMessage[] = [];
  for (const poll of open) {
    const [voters, voted] = await Promise.all([
      votersOf(db, poll.seasonId, poll.includeCoCaptains),
      db
        .select({ teamSeasonId: captainPollVote.teamSeasonId })
        .from(captainPollVote)
        .where(eq(captainPollVote.captainPollId, poll.id)),
    ]);
    const done = new Set<string>(voted.map((v) => v.teamSeasonId));
    messages.push(
      ...queueFor(
        poll,
        voters.filter((v) => !done.has(v.teamSeasonId)),
        "reminder",
        `reminder/${input.today}`,
      ),
    );
  }
  return enqueueMessages(db, messages);
}

/** How many teams have not voted yet, for the admin's reminder button. */
export async function teamsWithoutVote(
  db: Db,
  pollId: CaptainPollId,
): Promise<number> {
  const poll = await pollById(db, pollId);
  if (!poll) return 0;
  const [teams, votes] = await Promise.all([
    liveTeams(db, poll.seasonId),
    db
      .select({ teamSeasonId: captainPollVote.teamSeasonId })
      .from(captainPollVote)
      .where(eq(captainPollVote.captainPollId, poll.id)),
  ]);
  const done = new Set<string>(votes.map((v) => v.teamSeasonId));
  return teams.filter((t) => !done.has(t.id)).length;
}
