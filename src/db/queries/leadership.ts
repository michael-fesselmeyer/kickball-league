import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type {
  LeadershipCheckInId,
  LeadershipOptionId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  BALLOT_DAYS,
  ballotFor,
  canAnswer,
  canOpenFor,
  CHECK_IN_DAYS,
  type CheckInChoice,
  type ChoiceError,
  checkChoice,
  checkOpen,
  DAY_MS,
  defaultChoice,
  type LeadRole,
  type Outcome,
  quorumMet,
  quorumNeeded,
  resultOf,
  resumedDeadline,
  REVIEW_DAYS,
  type RosterRole,
  standing,
  type Step,
  stillAnswering,
  tally,
} from "@/domain/leadership/leadership";
import { dateTimeFormat } from "@/domain/time/format-cache";
import { err, ok, type Result } from "@/domain/result";
import type { LeadershipPayload } from "@/emails/leadership";
import { user } from "../schema/auth";
import {
  leadershipBallotOption,
  leadershipCandidate,
  leadershipCheckIn,
  leadershipParticipation,
} from "../schema/leadership";
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
import { offerCaptaincy, setTeamRole } from "./captaincy";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * The season-end leadership check-in (ADR 0077). The rules are in
 * src/domain/leadership; this file reads and writes the rows.
 *
 * Secrecy: a check-in or a vote writes a participation row and then one
 * UPDATE over every candidate or option row of its check-in, so the rows'
 * last writer is the same for all of them. Neither writes an audit row, a
 * log line or a message. Nothing here returns a vote count or who
 * suggested whom; the only counts returned are how many took part.
 */

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A teammate')`;

type Member = { userId: UserId; name: string; role: RosterRole };

/** A team season's active roster, captain first, then by name. */
async function rosterOf(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<Member[]> {
  const rows = await db
    .select({
      userId: registration.userId,
      name: shortName,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(user, eq(registration.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    )
    .orderBy(asc(shortName));
  const order = { captain: 0, co_captain: 1, player: 2 };
  return rows.sort((a, b) => order[a.role] - order[b.role]);
}

type About = {
  seasonName: string;
  seasonSlug: string;
  team: string;
  timeZone: string;
};

type CheckInRow = typeof leadershipCheckIn.$inferSelect;

/** Locks a check-in and returns it with what messages need to name it. */
async function lockCheckIn(
  db: Db,
  id: LeadershipCheckInId,
): Promise<(CheckInRow & { about: About }) | null> {
  const [row] = await db
    .select({
      checkIn: leadershipCheckIn,
      seasonName: season.name,
      seasonSlug: season.slug,
      team: team.name,
      timeZone: league.timezone,
    })
    .from(leadershipCheckIn)
    .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(leadershipCheckIn.id, id))
    .for("update", { of: leadershipCheckIn });
  if (!row) return null;
  const { checkIn, ...about } = row;
  return { ...checkIn, about };
}

/** "Sunday, November 22", in the league's time zone. */
export function dayName(instant: Date, timeZone: string): string {
  return dateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(instant);
}

const notice = (
  userId: UserId,
  template: "leadership_check_in" | "leadership_result",
  about: About,
  body: DistributiveOmit<
    LeadershipPayload,
    "seasonName" | "seasonSlug" | "team"
  >,
  dedupeKey: string,
  now: Date,
): OutboxMessage => ({
  userId,
  topic: "team_roles",
  template,
  payload: {
    seasonName: about.seasonName,
    seasonSlug: about.seasonSlug,
    team: about.team,
    ...body,
  },
  dedupeKey,
  sendAfter: now,
});

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

// ---------------------------------------------------------------------------
// Opening, for admins

export type OpenError = "not_found" | "not_season_end" | "bad_close";

/**
 * Opens a check-in for every team in the season with an active roster that
 * hasn't had one, and tells each roster. Season boundaries only. Returns
 * how many opened.
 */
export async function openCheckIns(
  db: Db,
  input: {
    seasonId: SeasonId;
    days: number;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<number, OpenError>> {
  const [found] = await db
    .select({
      status: season.status,
      name: season.name,
      slug: season.slug,
      quorum: league.leadershipQuorumPercent,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, input.seasonId));
  if (!found) return err("not_found");
  if (!canOpenFor(found.status)) return err("not_season_end");
  if (
    !Number.isInteger(input.days) ||
    input.days < CHECK_IN_DAYS.min ||
    input.days > CHECK_IN_DAYS.max
  )
    return err("bad_close");
  const closesAt = new Date(input.now.getTime() + input.days * DAY_MS);
  const teams = await db
    .selectDistinct({ id: teamSeason.id, team: team.name })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .innerJoin(
      rosterMembership,
      and(
        eq(rosterMembership.teamSeasonId, teamSeason.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .where(
      and(
        eq(teamSeason.seasonId, input.seasonId),
        ne(teamSeason.status, "withdrawn"),
      ),
    );
  if (teams.length === 0) return ok(0);
  const opened = await db
    .insert(leadershipCheckIn)
    .values(
      teams.map((t) => ({
        teamSeasonId: t.id,
        quorumPercent: found.quorum,
        checkInClosesAt: closesAt,
        openedBy: input.actorId,
        createdAt: input.now,
      })),
    )
    .onConflictDoNothing({ target: leadershipCheckIn.teamSeasonId })
    .returning({
      id: leadershipCheckIn.id,
      teamSeasonId: leadershipCheckIn.teamSeasonId,
    });
  if (opened.length === 0) return ok(0);
  await recordAudit(db, {
    actorId: input.actorId,
    action: "leadership.open",
    entityType: "season",
    entityId: input.seasonId,
    after: { teams: opened.length, closesAt: closesAt.toISOString() },
  });
  const messages: OutboxMessage[] = [];
  for (const o of opened) {
    const about = {
      seasonName: found.name,
      seasonSlug: found.slug,
      team: teams.find((t) => t.id === o.teamSeasonId)?.team ?? "Your team",
      timeZone: found.timeZone,
    };
    for (const m of await rosterOf(db, o.teamSeasonId))
      messages.push(
        notice(
          m.userId,
          "leadership_check_in",
          about,
          { kind: "opened", closes: dayName(closesAt, found.timeZone) },
          `leadership/${o.id}/opened/${m.userId}`,
          input.now,
        ),
      );
  }
  await enqueueMessages(db, messages);
  return ok(opened.length);
}

// ---------------------------------------------------------------------------
// Taking part, for players

export type CheckInError =
  | "not_found"
  | "paused"
  | "closed"
  | "already"
  | ChoiceError;

/**
 * Makes sure every person on the roster has a candidate row for both
 * roles before any choice is written, so a row's existence never says that
 * somebody was suggested.
 */
async function ensureCandidates(
  db: Db,
  checkInId: LeadershipCheckInId,
  roster: readonly Member[],
) {
  if (roster.length === 0) return;
  await db
    .insert(leadershipCandidate)
    .values(
      roster.flatMap((m) =>
        (["captain", "co_captain"] as const).map((role) => ({
          checkInId,
          userId: m.userId,
          role,
        })),
      ),
    )
    .onConflictDoNothing();
}

/**
 * A player's check-in: once, private, final. Writes that they took part,
 * then sets the flags on every candidate row of the team in one statement.
 */
export async function submitCheckIn(
  db: Db,
  input: {
    checkInId: LeadershipCheckInId;
    userId: UserId;
    choice: CheckInChoice<UserId>;
    now: Date;
  },
): Promise<Result<void, CheckInError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  const open = checkOpen(checkIn, "check_in", input.now);
  if (!open.ok) return open;
  const roster = await rosterOf(db, checkIn.teamSeasonId);
  const allowed = checkChoice(
    input.userId,
    new Map(roster.map((m) => [m.userId, m.role])),
    input.choice,
  );
  if (!allowed.ok) return allowed;
  const choice = allowed.value;
  const [took] = await db
    .insert(leadershipParticipation)
    .values({ checkInId: input.checkInId, userId: input.userId, part: "check_in" })
    .onConflictDoNothing()
    .returning({ userId: leadershipParticipation.userId });
  if (!took) return err("already");
  await ensureCandidates(db, input.checkInId, roster);
  const c = leadershipCandidate;
  const volunteers =
    choice.volunteer.length > 0
      ? and(eq(c.userId, input.userId), inArray(c.role, [...choice.volunteer]))
      : undefined;
  const suggested = choice.suggest
    ? and(eq(c.userId, choice.suggest.userId), eq(c.role, choice.suggest.role))
    : undefined;
  // One statement over every row of the check-in: each row is rewritten
  // whatever was chosen, so no row's last writer marks the choice.
  await db
    .update(c)
    .set({
      volunteered: sql`${c.volunteered} or coalesce(${volunteers ?? sql`false`}, false)`,
      nominated: sql`${c.nominated} or coalesce(${suggested ?? sql`false`}, false)`,
    })
    .where(eq(c.checkInId, input.checkInId));
  if (choice.steppingDown)
    await db
      .update(leadershipCheckIn)
      .set({ captainSteppingDown: true })
      .where(eq(leadershipCheckIn.id, input.checkInId));
  return ok(undefined);
}

export type AnswerError = "not_found" | "paused" | "closed" | "not_asked";

/**
 * A suggested teammate says whether they'd stand, or a volunteer
 * withdraws. Until the ballot opens; they can change their mind until then.
 */
export async function answerSuggestion(
  db: Db,
  input: {
    checkInId: LeadershipCheckInId;
    userId: UserId;
    role: LeadRole;
    accept: boolean;
    now: Date;
  },
): Promise<Result<void, AnswerError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  if (checkIn.pausedAt) return err("paused");
  if (!canAnswer(checkIn)) return err("closed");
  const roster = await rosterOf(db, checkIn.teamSeasonId);
  if (!roster.some((m) => m.userId === input.userId)) return err("not_found");
  const c = leadershipCandidate;
  const [updated] = await db
    .update(c)
    .set({
      answer: input.accept ? "accepted" : "declined",
      answeredAt: input.now,
    })
    .where(
      and(
        eq(c.checkInId, input.checkInId),
        eq(c.userId, input.userId),
        eq(c.role, input.role),
        // Only what they can see: a suggestion they were asked about, or
        // their own volunteering.
        sql`(${c.volunteered} or (${c.nominated} and ${c.askedAt} is not null))`,
      ),
    )
    .returning({ id: c.id });
  if (!updated) return err("not_asked");
  return ok(undefined);
}

export type VoteError = "not_found" | "paused" | "closed" | "already" | "not_on_team";

/**
 * A secret ballot: once, final. Writes that they voted, then adds 1 to the
 * chosen option and 0 to every other option in one statement.
 */
export async function castVote(
  db: Db,
  input: {
    checkInId: LeadershipCheckInId;
    userId: UserId;
    optionId: LeadershipOptionId;
    now: Date;
  },
): Promise<Result<void, VoteError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  const open = checkOpen(checkIn, "ballot", input.now);
  if (!open.ok) return open;
  const roster = await rosterOf(db, checkIn.teamSeasonId);
  if (!roster.some((m) => m.userId === input.userId))
    return err("not_on_team");
  const o = leadershipBallotOption;
  const [option] = await db
    .select({ id: o.id })
    .from(o)
    .where(and(eq(o.id, input.optionId), eq(o.checkInId, input.checkInId)));
  if (!option) return err("not_found");
  const [took] = await db
    .insert(leadershipParticipation)
    .values({ checkInId: input.checkInId, userId: input.userId, part: "ballot" })
    .onConflictDoNothing()
    .returning({ userId: leadershipParticipation.userId });
  if (!took) return err("already");
  await db
    .update(o)
    .set({
      votes: sql`${o.votes} + (case when ${o.id} = ${input.optionId} then 1 else 0 end)`,
    })
    .where(eq(o.checkInId, input.checkInId));
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// The daily job

/** How many on the roster took part in a step. */
async function tookPart(
  db: Db,
  checkInId: LeadershipCheckInId,
  part: "check_in" | "ballot",
  roster: readonly Member[],
): Promise<number> {
  if (roster.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leadershipParticipation)
    .where(
      and(
        eq(leadershipParticipation.checkInId, checkInId),
        eq(leadershipParticipation.part, part),
        inArray(
          leadershipParticipation.userId,
          roster.map((m) => m.userId),
        ),
      ),
    );
  return row?.n ?? 0;
}

async function candidatesOf(db: Db, checkInId: LeadershipCheckInId) {
  return db
    .select({
      userId: leadershipCandidate.userId,
      role: leadershipCandidate.role,
      volunteered: leadershipCandidate.volunteered,
      nominated: leadershipCandidate.nominated,
      answer: leadershipCandidate.answer,
      askedAt: leadershipCandidate.askedAt,
    })
    .from(leadershipCandidate)
    .where(eq(leadershipCandidate.checkInId, checkInId));
}

/** Closes a check-in with an outcome and tells the roster. */
async function closeWith(
  db: Db,
  checkIn: CheckInRow & { about: About },
  outcome: Outcome,
  now: Date,
  extra: {
    actorId?: UserId | null;
    elected?: string;
    when?: "now" | "next_season";
    captainChoice?: "hand_off_now" | "captain_elect";
  } = {},
) {
  await db
    .update(leadershipCheckIn)
    .set({
      step: "closed",
      outcome,
      closedAt: now,
      pausedAt: null,
      ...(extra.captainChoice ? { captainChoice: extra.captainChoice } : {}),
    })
    .where(eq(leadershipCheckIn.id, checkIn.id));
  await recordAudit(db, {
    actorId: extra.actorId ?? null,
    action: "leadership.close",
    entityType: "team_season",
    entityId: checkIn.teamSeasonId,
    after: {
      checkInId: checkIn.id,
      outcome,
      ...(extra.captainChoice ? { captainChoice: extra.captainChoice } : {}),
    },
  });
  const roster = await rosterOf(db, checkIn.teamSeasonId);
  await enqueueMessages(
    db,
    roster.map((m) =>
      notice(
        m.userId,
        "leadership_check_in",
        checkIn.about,
        {
          kind: "outcome",
          outcome,
          ...(extra.elected ? { elected: extra.elected } : {}),
          ...(extra.when ? { when: extra.when } : {}),
        },
        `leadership/${checkIn.id}/outcome/${m.userId}`,
        now,
      ),
    ),
  );
}

/**
 * The newest season of the same team where the elected teammate plays,
 * from the check-in's own season on, so a team already entered in next
 * season is handed over there. Falls back to the check-in's own season.
 */
async function targetTeamSeason(
  db: Db,
  teamSeasonId: TeamSeasonId,
  electedId: UserId,
): Promise<TeamSeasonId> {
  const [mine] = await db
    .select({ teamId: teamSeason.teamId, startsOn: season.startsOn })
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(eq(teamSeason.id, teamSeasonId));
  if (!mine) return teamSeasonId;
  const [newest] = await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .innerJoin(
      rosterMembership,
      and(
        eq(rosterMembership.teamSeasonId, teamSeason.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .innerJoin(
      registration,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(registration.userId, electedId),
      ),
    )
    .where(
      and(
        eq(teamSeason.teamId, mine.teamId),
        gte(season.startsOn, mine.startsOn),
        ne(teamSeason.status, "withdrawn"),
      ),
    )
    .orderBy(desc(season.startsOn))
    .limit(1);
  return newest?.id ?? teamSeasonId;
}

/**
 * Carries out the captain's choice after a ballot chose a teammate, then
 * tells the team. Handing over now makes a captaincy offer the teammate
 * accepts (ADR 0042); otherwise the teammate co-captains now and is offered
 * the captaincy once the team's next season starts.
 */
async function applyNewCaptain(
  db: Db,
  checkIn: CheckInRow & { about: About },
  choice: "hand_off_now" | "captain_elect",
  actorId: UserId | null,
  now: Date,
) {
  const electedId = checkIn.electedUserId;
  if (!electedId) return;
  const target = await targetTeamSeason(db, checkIn.teamSeasonId, electedId);
  const roster = await rosterOf(db, target);
  const elected = roster.find((m) => m.userId === electedId);
  if (choice === "hand_off_now") {
    // A refused offer (say, a team-fee checkout is open) leaves the captain
    // to hand over by hand; the outcome stands either way.
    await offerCaptaincy(db, {
      teamSeasonId: target,
      toUserId: electedId,
      actorId,
      now,
    });
    await db
      .update(leadershipCheckIn)
      .set({ electOfferedAt: now })
      .where(eq(leadershipCheckIn.id, checkIn.id));
  } else if (elected?.role === "player") {
    await setTeamRole(db, {
      teamSeasonId: target,
      userId: electedId,
      role: "co_captain",
      actorId,
      now,
    });
  }
  await closeWith(db, checkIn, "new_captain", now, {
    actorId,
    elected: elected?.name ?? "Your new captain",
    when: choice === "hand_off_now" ? "now" : "next_season",
    captainChoice: choice,
  });
}

/**
 * Moves every check-in along, from the daily job: asks newly suggested
 * teammates in one batch, closes check-ins and ballots that are due, ends
 * the captain's private time, and offers captains-elect the captaincy once
 * their team's next season starts. Paused check-ins are left alone. Safe
 * to run twice.
 */
export async function advanceCheckIns(
  db: Db,
  now: Date,
): Promise<{
  asked: number;
  ballots: number;
  closed: number;
  results: number;
  electOffers: number;
}> {
  const counts = { asked: 0, ballots: 0, closed: 0, results: 0, electOffers: 0 };
  counts.asked = await askSuggested(db, now);

  const due = await db
    .select({ id: leadershipCheckIn.id })
    .from(leadershipCheckIn)
    .where(
      and(
        ne(leadershipCheckIn.step, "closed"),
        isNull(leadershipCheckIn.pausedAt),
      ),
    );
  for (const { id } of due) {
    const checkIn = await lockCheckIn(db, id);
    if (!checkIn || checkIn.pausedAt || checkIn.step === "closed") continue;
    const step = await advanceOne(db, checkIn, now);
    if (step === "ballot") counts.ballots++;
    else if (step === "closed") counts.closed++;
    else if (step === "captain_review") counts.results++;
  }

  counts.electOffers = await offerToCaptainsElect(db, now);
  return counts;
}

/**
 * Asks every suggested teammate not yet asked, in one batch, so the time
 * of the message never lines up with the check-in that suggested them.
 */
async function askSuggested(db: Db, now: Date): Promise<number> {
  const c = leadershipCandidate;
  const rows = await db
    .select({
      id: c.id,
      checkInId: c.checkInId,
      userId: c.userId,
      role: c.role,
      teamSeasonId: leadershipCheckIn.teamSeasonId,
    })
    .from(c)
    .innerJoin(leadershipCheckIn, eq(c.checkInId, leadershipCheckIn.id))
    .where(
      and(
        eq(leadershipCheckIn.step, "check_in"),
        isNull(leadershipCheckIn.pausedAt),
        eq(c.nominated, true),
        eq(c.volunteered, false),
        isNull(c.askedAt),
        isNull(c.answer),
      ),
    );
  if (rows.length === 0) return 0;
  await db
    .update(c)
    .set({ askedAt: now })
    .where(inArray(c.id, rows.map((r) => r.id)));
  const messages: OutboxMessage[] = [];
  for (const checkInId of new Set(rows.map((r) => r.checkInId))) {
    const checkIn = await lockCheckIn(db, checkInId);
    if (!checkIn) continue;
    const onRoster = new Set(
      (await rosterOf(db, checkIn.teamSeasonId)).map((m) => m.userId),
    );
    for (const r of rows.filter((r) => r.checkInId === checkInId))
      if (onRoster.has(r.userId))
        messages.push(
          notice(
            r.userId,
            "leadership_check_in",
            checkIn.about,
            { kind: "suggested", role: r.role },
            `leadership/${checkInId}/suggested/${r.role}/${r.userId}`,
            now,
          ),
        );
  }
  await enqueueMessages(db, messages);
  return messages.length;
}

/** Moves one check-in on if its step is due; returns its step after. */
async function advanceOne(
  db: Db,
  checkIn: CheckInRow & { about: About },
  now: Date,
): Promise<Step> {
  if (checkIn.step === "check_in") {
    if (now < checkIn.checkInClosesAt) return "check_in";
    const roster = await rosterOf(db, checkIn.teamSeasonId);
    const onRoster = new Set(roster.map((m) => m.userId));
    const candidates = await candidatesOf(db, checkIn.id);
    // Give a teammate suggested late a fair chance to answer.
    if (
      candidates.some(
        (c) => c.role === "captain" && onRoster.has(c.userId) && stillAnswering(c, now),
      )
    )
      return "check_in";
    const took = await tookPart(db, checkIn.id, "check_in", roster);
    if (!quorumMet(took, roster.length, checkIn.quorumPercent)) {
      await closeWith(db, checkIn, "no_quorum", now);
      return "closed";
    }
    const captainId = roster.find((m) => m.role === "captain")?.userId ?? null;
    const options = ballotFor({
      captainId,
      captainSteppingDown: checkIn.captainSteppingDown,
      candidates,
      onRoster,
    });
    if (!options) {
      await closeWith(db, checkIn, "no_candidates", now);
      return "closed";
    }
    const ballotClosesAt = new Date(now.getTime() + BALLOT_DAYS * DAY_MS);
    await db
      .insert(leadershipBallotOption)
      .values(options.map((userId) => ({ checkInId: checkIn.id, userId })))
      .onConflictDoNothing();
    await db
      .update(leadershipCheckIn)
      .set({ step: "ballot", ballotClosesAt })
      .where(eq(leadershipCheckIn.id, checkIn.id));
    await enqueueMessages(
      db,
      roster.map((m) =>
        notice(
          m.userId,
          "leadership_check_in",
          checkIn.about,
          {
            kind: "ballot",
            closes: dayName(ballotClosesAt, checkIn.about.timeZone),
          },
          `leadership/${checkIn.id}/ballot/${m.userId}`,
          now,
        ),
      ),
    );
    return "ballot";
  }

  if (checkIn.step === "ballot") {
    if (!checkIn.ballotClosesAt || now < checkIn.ballotClosesAt)
      return "ballot";
    const roster = await rosterOf(db, checkIn.teamSeasonId);
    const took = await tookPart(db, checkIn.id, "ballot", roster);
    if (!quorumMet(took, roster.length, checkIn.quorumPercent)) {
      await closeWith(db, checkIn, "no_quorum", now);
      return "closed";
    }
    // Read only to tally, here; never returned or logged.
    const options = await db
      .select({
        userId: leadershipBallotOption.userId,
        votes: leadershipBallotOption.votes,
      })
      .from(leadershipBallotOption)
      .where(eq(leadershipBallotOption.checkInId, checkIn.id));
    const captainId = roster.find((m) => m.role === "captain")?.userId ?? null;
    const result = resultOf({
      tally: tally(options),
      captainId,
      onRoster: new Set(roster.map((m) => m.userId)),
    });
    // Every result waits the captain's private three days, whatever it is,
    // so the wait itself never tells the team which way it went.
    const reviewEndsAt = new Date(now.getTime() + REVIEW_DAYS * DAY_MS);
    const electedId = result.outcome === "new_captain" ? result.electedId : null;
    await db
      .update(leadershipCheckIn)
      .set({
        step: "captain_review",
        outcome: result.outcome,
        electedUserId: electedId,
        reviewEndsAt,
      })
      .where(eq(leadershipCheckIn.id, checkIn.id));
    if (captainId && electedId) {
      const elected =
        roster.find((m) => m.userId === electedId)?.name ?? "A teammate";
      await enqueueMessages(db, [
        notice(
          captainId,
          "leadership_result",
          checkIn.about,
          {
            kind: "result",
            elected,
            decideBy: dayName(reviewEndsAt, checkIn.about.timeZone),
            steppingDown: checkIn.captainSteppingDown,
          },
          `leadership/${checkIn.id}/result`,
          now,
        ),
      ]);
    }
    return "captain_review";
  }

  if (checkIn.step === "captain_review") {
    if (!checkIn.reviewEndsAt || now < checkIn.reviewEndsAt)
      return "captain_review";
    if (checkIn.outcome === "new_captain")
      await applyNewCaptain(
        db,
        checkIn,
        defaultChoice(checkIn.captainSteppingDown),
        null,
        now,
      );
    else await closeWith(db, checkIn, checkIn.outcome ?? "no_majority", now);
    return "closed";
  }
  return checkIn.step;
}

/**
 * Captains-elect: once the team's next season has started, with both of
 * them on its roster, the captaincy is offered to the captain-elect, who
 * accepts as usual. Tried once.
 */
async function offerToCaptainsElect(db: Db, now: Date): Promise<number> {
  const waiting = await db
    .select({
      id: leadershipCheckIn.id,
      teamSeasonId: leadershipCheckIn.teamSeasonId,
      electedUserId: leadershipCheckIn.electedUserId,
      teamId: teamSeason.teamId,
      startsOn: season.startsOn,
    })
    .from(leadershipCheckIn)
    .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
    .innerJoin(season, eq(teamSeason.seasonId, season.id))
    .where(
      and(
        eq(leadershipCheckIn.step, "closed"),
        eq(leadershipCheckIn.captainChoice, "captain_elect"),
        isNull(leadershipCheckIn.electOfferedAt),
      ),
    );
  let offered = 0;
  for (const w of waiting) {
    if (!w.electedUserId) continue;
    const [next] = await db
      .select({ id: teamSeason.id })
      .from(teamSeason)
      .innerJoin(season, eq(teamSeason.seasonId, season.id))
      .where(
        and(
          eq(teamSeason.teamId, w.teamId),
          sql`${season.startsOn} > ${w.startsOn}`,
          inArray(season.status, ["in_progress", "playoffs"]),
          ne(teamSeason.status, "withdrawn"),
        ),
      )
      .orderBy(asc(season.startsOn))
      .limit(1);
    if (!next) continue;
    const result = await offerCaptaincy(db, {
      teamSeasonId: next.id,
      toUserId: w.electedUserId,
      actorId: null,
      now,
    });
    await db
      .update(leadershipCheckIn)
      .set({ electOfferedAt: now })
      .where(eq(leadershipCheckIn.id, w.id));
    if (result.ok) offered++;
  }
  return offered;
}

// ---------------------------------------------------------------------------
// The captain's private choice

export type ChooseError = "not_found" | "paused" | "not_captain" | "closed";

/** The captain chooses how to hand over, then the team hears. */
export async function captainChooses(
  db: Db,
  input: {
    checkInId: LeadershipCheckInId;
    userId: UserId;
    choice: "hand_off_now" | "captain_elect";
    now: Date;
  },
): Promise<Result<void, ChooseError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  if (checkIn.step !== "captain_review" || checkIn.outcome !== "new_captain")
    return err("closed");
  if (checkIn.pausedAt) return err("paused");
  const roster = await rosterOf(db, checkIn.teamSeasonId);
  if (roster.find((m) => m.role === "captain")?.userId !== input.userId)
    return err("not_captain");
  await applyNewCaptain(db, checkIn, input.choice, input.userId, input.now);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Admins: pause, resume, close

export type AdminError = "not_found" | "closed" | "paused" | "not_paused";

export async function pauseCheckIn(
  db: Db,
  input: { checkInId: LeadershipCheckInId; actorId: UserId; now: Date },
): Promise<Result<void, AdminError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  if (checkIn.step === "closed") return err("closed");
  if (checkIn.pausedAt) return err("paused");
  await db
    .update(leadershipCheckIn)
    .set({ pausedAt: input.now })
    .where(eq(leadershipCheckIn.id, checkIn.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "leadership.pause",
    entityType: "team_season",
    entityId: checkIn.teamSeasonId,
    after: { checkInId: checkIn.id, step: checkIn.step },
  });
  return ok(undefined);
}

/** Resuming moves the current step's deadline on by the time paused. */
export async function resumeCheckIn(
  db: Db,
  input: { checkInId: LeadershipCheckInId; actorId: UserId; now: Date },
): Promise<Result<void, AdminError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  if (checkIn.step === "closed") return err("closed");
  const pausedAt = checkIn.pausedAt;
  if (!pausedAt) return err("not_paused");
  const later = (d: Date | null) =>
    d ? resumedDeadline(d, pausedAt, input.now) : null;
  await db
    .update(leadershipCheckIn)
    .set({
      pausedAt: null,
      ...(checkIn.step === "check_in"
        ? { checkInClosesAt: resumedDeadline(checkIn.checkInClosesAt, pausedAt, input.now) }
        : checkIn.step === "ballot"
          ? { ballotClosesAt: later(checkIn.ballotClosesAt) }
          : { reviewEndsAt: later(checkIn.reviewEndsAt) }),
    })
    .where(eq(leadershipCheckIn.id, checkIn.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "leadership.resume",
    entityType: "team_season",
    entityId: checkIn.teamSeasonId,
    after: { checkInId: checkIn.id, step: checkIn.step },
  });
  return ok(undefined);
}

/** An admin steps in: the check-in closes with no change. */
export async function closeByLeague(
  db: Db,
  input: { checkInId: LeadershipCheckInId; actorId: UserId; now: Date },
): Promise<Result<void, AdminError>> {
  const checkIn = await lockCheckIn(db, input.checkInId);
  if (!checkIn) return err("not_found");
  if (checkIn.step === "closed") return err("closed");
  await closeWith(db, checkIn, "closed_by_league", input.now, {
    actorId: input.actorId,
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Views. None returns a vote count or who suggested whom.

export type LeadershipView = {
  id: LeadershipCheckInId;
  step: Step;
  outcome: Outcome | null;
  paused: boolean;
  checkInClosesAt: Date;
  ballotClosesAt: Date | null;
  reviewEndsAt: Date | null;
  /** Taking part in the current step, of the roster now. */
  progress: { tookPart: number; needed: number; roster: number };
  me: {
    onRoster: boolean;
    role: RosterRole | null;
    checkedIn: boolean;
    voted: boolean;
    /** Suggestions they were asked about, and their own volunteering. */
    asks: {
      role: LeadRole;
      volunteered: boolean;
      answer: "accepted" | "declined" | null;
    }[];
  };
  /** Teammates who could be suggested, with their roles. */
  teammates: { userId: UserId; name: string; role: RosterRole }[];
  /** The ballot's choices, by name, while it is open. */
  ballot: { id: LeadershipOptionId; name: string; isCaptain: boolean }[];
  /** For the captain alone, in their private time: the ballot's result. */
  resultForCaptain: Outcome | null;
  /** For the captain alone, in their private time: who the team chose. */
  electedForCaptain: string | null;
  /** The teammate chosen, once the team has heard. */
  elected: string | null;
  captainChoice: "hand_off_now" | "captain_elect" | null;
  /**
   * For the captain alone, once closed: teammates standing as co-captain
   * who are still players, to add with the usual tools.
   */
  helpers: string[];
};

/** The team's check-in as one person sees it, for the leadership page. */
export async function leadershipFor(
  db: Db,
  teamSeasonId: TeamSeasonId,
  userId: UserId,
): Promise<LeadershipView | null> {
  const [checkIn] = await db
    .select()
    .from(leadershipCheckIn)
    .where(eq(leadershipCheckIn.teamSeasonId, teamSeasonId));
  if (!checkIn) return null;
  const roster = await rosterOf(db, teamSeasonId);
  const me = roster.find((m) => m.userId === userId) ?? null;
  const [parts, mine, options] = await Promise.all([
    db
      .select({
        userId: leadershipParticipation.userId,
        part: leadershipParticipation.part,
      })
      .from(leadershipParticipation)
      .where(eq(leadershipParticipation.checkInId, checkIn.id)),
    candidatesOf(db, checkIn.id),
    checkIn.step === "ballot"
      ? db
          .select({
            id: leadershipBallotOption.id,
            userId: leadershipBallotOption.userId,
          })
          .from(leadershipBallotOption)
          .where(eq(leadershipBallotOption.checkInId, checkIn.id))
      : Promise.resolve([]),
  ]);
  const onRoster = new Set(roster.map((m) => m.userId));
  const part = checkIn.step === "ballot" ? "ballot" : "check_in";
  const tookPartNow = parts.filter(
    (p) => p.part === part && onRoster.has(p.userId),
  ).length;
  const isCaptain = me?.role === "captain";
  const nameOf = (id: UserId | null) =>
    id ? (roster.find((m) => m.userId === id)?.name ?? "A former teammate") : null;
  const captainId = roster.find((m) => m.role === "captain")?.userId;
  return {
    id: checkIn.id,
    step: checkIn.step,
    // The team hears the outcome only once it is closed.
    outcome: checkIn.step === "closed" ? checkIn.outcome : null,
    paused: checkIn.pausedAt !== null,
    checkInClosesAt: checkIn.checkInClosesAt,
    ballotClosesAt: checkIn.ballotClosesAt,
    reviewEndsAt: checkIn.reviewEndsAt,
    progress: {
      tookPart: tookPartNow,
      needed: quorumNeeded(roster.length, checkIn.quorumPercent),
      roster: roster.length,
    },
    me: {
      onRoster: me !== null,
      role: me?.role ?? null,
      checkedIn: parts.some(
        (p) => p.userId === userId && p.part === "check_in",
      ),
      voted: parts.some((p) => p.userId === userId && p.part === "ballot"),
      asks: mine
        .filter(
          (c) =>
            c.userId === userId &&
            (c.volunteered || (c.nominated && c.askedAt !== null)),
        )
        .map((c) => ({
          role: c.role,
          volunteered: c.volunteered,
          answer: c.answer,
        })),
    },
    teammates: roster
      .filter((m) => m.userId !== userId)
      .map(({ userId: id, name, role }) => ({ userId: id, name, role })),
    ballot: options.map((o) => ({
      id: o.id,
      name: nameOf(o.userId) ?? "A teammate",
      isCaptain: o.userId === captainId,
    })),
    resultForCaptain:
      checkIn.step === "captain_review" && isCaptain ? checkIn.outcome : null,
    electedForCaptain:
      checkIn.step === "captain_review" && isCaptain
        ? nameOf(checkIn.electedUserId)
        : null,
    elected:
      checkIn.step === "closed" && checkIn.outcome === "new_captain"
        ? nameOf(checkIn.electedUserId)
        : null,
    captainChoice: checkIn.step === "closed" ? checkIn.captainChoice : null,
    helpers:
      checkIn.step === "closed" && isCaptain
        ? mine
            .filter(
              (c) =>
                c.role === "co_captain" &&
                standing(c) &&
                roster.find((m) => m.userId === c.userId)?.role === "player",
            )
            .map((c) => nameOf(c.userId) ?? "A teammate")
        : [],
  };
}

/** Just enough for the team page's card, for everyone on the team. */
export async function checkInStep(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<{ step: Step; outcome: Outcome | null; paused: boolean } | null> {
  const [row] = await db
    .select({
      step: leadershipCheckIn.step,
      outcome: leadershipCheckIn.outcome,
      pausedAt: leadershipCheckIn.pausedAt,
    })
    .from(leadershipCheckIn)
    .where(eq(leadershipCheckIn.teamSeasonId, teamSeasonId));
  return row
    ? {
        step: row.step,
        outcome: row.step === "closed" ? row.outcome : null,
        paused: row.pausedAt !== null,
      }
    : null;
}

export type SeasonLeadershipRow = {
  checkInId: LeadershipCheckInId;
  team: string;
  step: Step;
  outcome: Outcome | null;
  paused: boolean;
  closesAt: Date | null;
  tookPart: number;
  needed: number;
  roster: number;
};

/**
 * Every team's check-in in a season, for admins: the step, the deadline
 * and how many took part. Never who chose what, or a vote count.
 */
export async function seasonLeadership(
  db: Db,
  seasonId: SeasonId,
): Promise<SeasonLeadershipRow[]> {
  const rows = await db
    .select({
      checkInId: leadershipCheckIn.id,
      team: team.name,
      step: leadershipCheckIn.step,
      outcome: leadershipCheckIn.outcome,
      pausedAt: leadershipCheckIn.pausedAt,
      quorum: leadershipCheckIn.quorumPercent,
      checkInClosesAt: leadershipCheckIn.checkInClosesAt,
      ballotClosesAt: leadershipCheckIn.ballotClosesAt,
      reviewEndsAt: leadershipCheckIn.reviewEndsAt,
      roster: sql<number>`(select count(*)::int from ${rosterMembership} where ${rosterMembership.teamSeasonId} = ${teamSeason.id} and ${rosterMembership.status} = 'active')`,
      tookPart: sql<number>`(select count(*)::int from ${leadershipParticipation} p join ${registration} r on r.user_id = p.user_id join ${rosterMembership} rm on rm.registration_id = r.id and rm.team_season_id = ${teamSeason.id} and rm.status = 'active' where p.check_in_id = ${leadershipCheckIn.id} and p.part = (case when ${leadershipCheckIn.step} = 'ballot' then 'ballot' else 'check_in' end)::leadership_part)`,
    })
    .from(leadershipCheckIn)
    .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(teamSeason.seasonId, seasonId))
    .orderBy(asc(team.name));
  return rows.map((r) => ({
    checkInId: r.checkInId,
    team: r.team,
    step: r.step,
    // Admins hear the outcome with the team, after the captain.
    outcome: r.step === "closed" ? r.outcome : null,
    paused: r.pausedAt !== null,
    closesAt:
      r.step === "check_in"
        ? r.checkInClosesAt
        : r.step === "ballot"
          ? r.ballotClosesAt
          : r.step === "captain_review"
            ? r.reviewEndsAt
            : null,
    tookPart: r.tookPart,
    needed: quorumNeeded(r.roster, r.quorum),
    roster: r.roster,
  }));
}

/** The team season a check-in is for, so actions can check permissions. */
export async function checkInTeam(
  db: Db,
  id: LeadershipCheckInId,
): Promise<{ teamSeasonId: TeamSeasonId; seasonId: SeasonId } | null> {
  const [row] = await db
    .select({
      teamSeasonId: leadershipCheckIn.teamSeasonId,
      seasonId: teamSeason.seasonId,
    })
    .from(leadershipCheckIn)
    .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
    .where(eq(leadershipCheckIn.id, id));
  return row ?? null;
}

/**
 * For a person's own export: the check-ins and ballots they took part in,
 * and what they stood for. Never what they chose: that isn't linked to
 * them anywhere.
 */
export async function myLeadership(db: Db, userId: UserId) {
  const [tookPart, stood] = await Promise.all([
    db
      .select({
        team: team.name,
        season: season.name,
        part: leadershipParticipation.part,
      })
      .from(leadershipParticipation)
      .innerJoin(
        leadershipCheckIn,
        eq(leadershipParticipation.checkInId, leadershipCheckIn.id),
      )
      .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .innerJoin(season, eq(teamSeason.seasonId, season.id))
      .where(eq(leadershipParticipation.userId, userId))
      .orderBy(asc(season.startsOn), asc(leadershipParticipation.part)),
    db
      .select({
        team: team.name,
        season: season.name,
        role: leadershipCandidate.role,
        volunteered: leadershipCandidate.volunteered,
        answer: leadershipCandidate.answer,
      })
      .from(leadershipCandidate)
      .innerJoin(
        leadershipCheckIn,
        eq(leadershipCandidate.checkInId, leadershipCheckIn.id),
      )
      .innerJoin(teamSeason, eq(leadershipCheckIn.teamSeasonId, teamSeason.id))
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .innerJoin(season, eq(teamSeason.seasonId, season.id))
      .where(
        and(
          eq(leadershipCandidate.userId, userId),
          sql`(${leadershipCandidate.volunteered} or ${leadershipCandidate.answer} is not null)`,
        ),
      )
      .orderBy(asc(season.startsOn)),
  ]);
  return {
    tookPart: tookPart.map((t) => ({
      team: t.team,
      season: t.season,
      step: t.part === "ballot" ? "voted" : "checked in",
    })),
    stoodFor: stood,
  };
}
