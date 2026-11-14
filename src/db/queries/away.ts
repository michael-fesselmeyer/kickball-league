import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  availabilityFor,
  type Member,
  newlyShort,
  nextAwayWeeks,
  seasonWeeks,
  type WeekAvailability,
  weekLabel,
  weekOf,
} from "@/domain/availability/away";
import type {
  GameId,
  RegistrationId,
  SeasonId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { type FieldingRules, RULEBOOK } from "@/domain/rsvp/fielding";
import { localDate } from "@/domain/scheduler/slots";
import type { AwayShortPayload } from "@/emails/away-short";
import { user } from "../schema/auth";
import { awayWeek } from "../schema/availability";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";
import { teamGames } from "./scores";

/** Away weeks: the weeks of a season a player will miss (issue #256). */

/** "Jo S.": first name and last initial, as on public rosters. */
const shortName = sql<string>`coalesce(${profile.firstName} || coalesce(' ' || left(${profile.lastName}, 1) || '.', ''), nullif(${user.name}, ''), 'A player')`;

const OVER = ["final", "forfeit", "cancelled"] as const;
const isOver = (status: string) => OVER.some((s) => s === status);

const rulesOf = (saved: Partial<FieldingRules> | null): FieldingRules => ({
  maxFielders: saved?.maxFielders ?? RULEBOOK.maxFielders,
  maxPerGender: saved?.maxPerGender ?? RULEBOOK.maxPerGender,
  minimumToPlay: saved?.minimumToPlay ?? RULEBOOK.minimumToPlay,
});

/** The team's active players, with the side they count toward. */
async function membersOf(
  db: Db,
  teamSeasonId: TeamSeasonId,
): Promise<
  (Member<UserId> & { registrationId: RegistrationId; role: string })[]
> {
  const rows = await db
    .select({
      userId: registration.userId,
      registrationId: registration.id,
      role: rosterMembership.role,
      name: shortName,
      side: profile.lineupGender,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .innerJoin(user, eq(user.id, registration.userId))
    .leftJoin(profile, eq(profile.userId, registration.userId))
    .where(
      and(
        eq(rosterMembership.teamSeasonId, teamSeasonId),
        eq(rosterMembership.status, "active"),
      ),
    )
    .orderBy(asc(shortName));
  return rows.map((r) => ({ ...r, side: r.side ?? null }));
}

/** The away weeks of each registration, as Mondays. */
async function weeksByRegistration(
  db: Db,
  registrationIds: readonly RegistrationId[],
): Promise<Map<RegistrationId, Set<string>>> {
  const result = new Map<RegistrationId, Set<string>>();
  if (registrationIds.length === 0) return result;
  const rows = await db
    .select({
      registrationId: awayWeek.registrationId,
      week: awayWeek.weekStart,
    })
    .from(awayWeek)
    .where(inArray(awayWeek.registrationId, [...registrationIds]));
  for (const r of rows)
    result.set(
      r.registrationId,
      (result.get(r.registrationId) ?? new Set()).add(r.week),
    );
  return result;
}

/** Each person's away weeks, as Mondays. */
async function awayOf(
  db: Db,
  members: readonly { userId: UserId; registrationId: RegistrationId }[],
): Promise<Map<UserId, Set<string>>> {
  const weeks = await weeksByRegistration(
    db,
    members.map((m) => m.registrationId),
  );
  return new Map(
    members.map((m) => [m.userId, weeks.get(m.registrationId) ?? new Set()]),
  );
}

export type AwaySeason = {
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  teamName: string | null;
  /** Every week of the season, with the team's games in it. */
  weeks: {
    week: string;
    label: string;
    away: boolean;
    /** Already started, so it can't be changed any more. */
    past: boolean;
    games: { opponent: string; startsAt: Date }[];
  }[];
};

/**
 * The seasons a person is registered for that are not over, with their
 * away weeks and their team's games, for the profile form.
 */
export async function awaySeasonsFor(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<AwaySeason[]> {
  const rows = await db
    .select({
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      timeZone: league.timezone,
      registrationId: registration.id,
      teamSeasonId: rosterMembership.teamSeasonId,
      teamName: team.name,
    })
    .from(registration)
    .innerJoin(season, eq(registration.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .leftJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .leftJoin(team, eq(team.id, teamSeason.teamId))
    .where(
      and(
        eq(registration.userId, userId),
        notInArray(registration.status, ["cancelled", "refunded"]),
        notInArray(season.status, ["draft", "completed"]),
      ),
    )
    .orderBy(asc(season.startsOn));
  const [marks, games] = await Promise.all([
    weeksByRegistration(
      db,
      rows.map((r) => r.registrationId),
    ),
    Promise.all(
      rows.map((r) => (r.teamSeasonId ? teamGames(db, r.teamSeasonId) : [])),
    ),
  ]);
  return rows.map((r, i) => {
    const thisWeek = weekOf(localDate(now, r.timeZone));
    const mine = marks.get(r.registrationId) ?? new Set<string>();
    const played = (games[i] ?? []).flatMap((g) =>
      g.startsAt ? [{ opponent: g.opponent, startsAt: g.startsAt }] : [],
    );
    return {
      seasonId: r.seasonId,
      seasonName: r.seasonName,
      seasonSlug: r.seasonSlug,
      teamName: r.teamName,
      weeks: seasonWeeks(r.startsOn, r.endsOn).map((week) => ({
        week,
        label: weekLabel(week),
        away: mine.has(week),
        past: week < thisWeek,
        games: played.filter(
          (g) => weekOf(localDate(g.startsAt, r.timeZone)) === week,
        ),
      })),
    };
  });
}

export type SaveAwayError = "not_registered" | "season_over";

/**
 * Saves the weeks a person will miss in a season. Weeks already gone keep
 * what they had. If the change leaves their team short of a full lineup in
 * a week it still has a game, the team's captains get one email about that
 * week, with a link to ask for subs.
 */
export async function saveAwayWeeks(
  db: Db,
  input: {
    userId: UserId;
    seasonId: SeasonId;
    weeks: readonly string[];
    now: Date;
  },
): Promise<Result<{ weeks: string[]; captainsTold: number }, SaveAwayError>> {
  const [found] = await db
    .select({
      registrationId: registration.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      status: season.status,
      startsOn: season.startsOn,
      endsOn: season.endsOn,
      rules: season.fieldingRules,
      timeZone: league.timezone,
      teamSeasonId: rosterMembership.teamSeasonId,
      teamName: team.name,
    })
    .from(registration)
    .innerJoin(season, eq(registration.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .leftJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .leftJoin(team, eq(team.id, teamSeason.teamId))
    .where(
      and(
        eq(registration.userId, input.userId),
        eq(registration.seasonId, input.seasonId),
        notInArray(registration.status, ["cancelled", "refunded"]),
      ),
    );
  if (!found) return err("not_registered");
  if (found.status === "completed" || found.status === "draft")
    return err("season_over");
  const thisWeek = weekOf(localDate(input.now, found.timeZone));
  const allWeeks = seasonWeeks(found.startsOn, found.endsOn);

  return db.transaction(async (tx) => {
    // One save at a time per person and season.
    await tx
      .select({ id: registration.id })
      .from(registration)
      .where(eq(registration.id, found.registrationId))
      .for("update");
    const members = found.teamSeasonId
      ? await membersOf(tx, found.teamSeasonId)
      : [];
    const self = { userId: input.userId, registrationId: found.registrationId };
    const before = await awayOf(tx, [
      self,
      ...members.filter((m) => m.userId !== input.userId),
    ]);
    const saved = [...(before.get(input.userId) ?? [])];
    const next = nextAwayWeeks(saved, input.weeks, allWeeks, thisWeek);
    const removed = saved.filter((w) => !next.includes(w));
    const added = next.filter((w) => !saved.includes(w));
    if (removed.length > 0)
      await tx
        .delete(awayWeek)
        .where(
          and(
            eq(awayWeek.registrationId, found.registrationId),
            inArray(awayWeek.weekStart, removed),
          ),
        );
    if (added.length > 0)
      await tx
        .insert(awayWeek)
        .values(
          added.map((weekStart) => ({
            registrationId: found.registrationId,
            weekStart,
          })),
        )
        .onConflictDoNothing();

    if (!found.teamSeasonId || added.length === 0 || !found.teamName)
      return ok({ weeks: next, captainsTold: 0 });
    // Tell the captains about weeks this change left short.
    const after = new Map(before).set(input.userId, new Set(next));
    const games = (await teamGames(tx, found.teamSeasonId)).filter(
      (g) => g.startsAt !== null && g.startsAt > input.now && !isOver(g.status),
    );
    const gameWeeks = [
      ...new Set(
        games.flatMap((g) =>
          g.startsAt ? [weekOf(localDate(g.startsAt, found.timeZone))] : [],
        ),
      ),
    ];
    const rules = rulesOf(found.rules);
    const short = newlyShort(members, before, after, gameWeeks, rules);
    const captains = members.filter(
      (m) =>
        (m.role === "captain" || m.role === "co_captain") &&
        m.userId !== input.userId,
    );
    const player = members.find((m) => m.userId === input.userId)?.name;
    const when = (d: Date) =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: found.timeZone,
      }).format(d);
    const messages: OutboxMessage[] = short.flatMap((week) => {
      const inWeek = games.filter(
        (g) =>
          g.startsAt && weekOf(localDate(g.startsAt, found.timeZone)) === week,
      );
      const [first] = inWeek;
      if (!first || !found.teamName || !found.teamSeasonId) return [];
      const state = availabilityFor(members, after, week, rules);
      const payload: AwayShortPayload = {
        seasonName: found.seasonName,
        seasonSlug: found.seasonSlug,
        team: found.teamName,
        week: weekLabel(week),
        player: player ?? "A player",
        available: state.available,
        fielding: state.fielding.message,
        games: inWeek.flatMap((g) =>
          g.startsAt ? [{ opponent: g.opponent, when: when(g.startsAt) }] : [],
        ),
        gameId: first.id,
        subsOpen: first.kind !== "playoff",
      };
      return captains.map((c) => ({
        userId: c.userId,
        topic: "sub_request" as const,
        template: "away_short" as const,
        payload,
        dedupeKey: `away_short:${found.teamSeasonId}:${week}:${c.userId}`,
        sendAfter: input.now,
      }));
    });
    const told = await enqueueMessages(tx, messages);
    return ok({ weeks: next, captainsTold: told });
  });
}

/**
 * For each of a team's games, who is available that week and what they
 * can field. Names of who is away are for the team's captains.
 */
export async function teamAvailability(
  db: Db,
  teamSeasonId: TeamSeasonId,
  games: readonly { id: GameId; startsAt: Date | null }[],
  timeZone: string,
): Promise<Map<GameId, WeekAvailability<UserId>>> {
  const result = new Map<GameId, WeekAvailability<UserId>>();
  const placed = games.filter((g) => g.startsAt !== null);
  if (placed.length === 0) return result;
  const [members, [found]] = await Promise.all([
    membersOf(db, teamSeasonId),
    db
      .select({ rules: season.fieldingRules })
      .from(teamSeason)
      .innerJoin(season, eq(season.id, teamSeason.seasonId))
      .where(eq(teamSeason.id, teamSeasonId)),
  ]);
  const marks = await awayOf(db, members);
  const rules = rulesOf(found?.rules ?? null);
  for (const g of placed)
    if (g.startsAt)
      result.set(
        g.id,
        availabilityFor(
          members,
          marks,
          weekOf(localDate(g.startsAt, timeZone)),
          rules,
        ),
      );
  return result;
}
