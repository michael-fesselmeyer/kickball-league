import { and, asc, eq, like, not, or } from "drizzle-orm";
import {
  type DivisionId,
  type FieldId,
  type LeagueId,
  parseId,
  type SeasonId,
  type TeamId,
  type TeamSeasonId,
  type UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import {
  planRollover,
  type RolloverChoice,
  type RolloverPlan,
  type RolloverProblem,
  type SourceTeam,
} from "@/domain/season/rollover";
import { user } from "../schema/auth";
import { division, ruleSet } from "../schema/division";
import { field, venue } from "../schema/game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { suspendedAmong } from "./discipline";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Season rollover (src/domain/season/rollover.ts says what is copied and
 * what starts fresh). `rolloverSource` reads everything the preview shows
 * in parallel; `rollOver` writes the new draft season in one transaction
 * and audits it.
 */

const nameOf = (r: {
  firstName: string | null;
  lastName: string | null;
  fallback: string;
}) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.fallback;

/** The source season and what can come with it; null when it isn't the league's. */
export async function rolloverSource(
  db: Db,
  leagueId: LeagueId,
  slug: string,
  now: Date,
) {
  const [found] = await db
    .select({ season, timeZone: league.timezone })
    .from(season)
    .innerJoin(league, eq(league.id, season.leagueId))
    .where(and(eq(season.leagueId, leagueId), eq(season.slug, slug)));
  if (!found) return null;
  const s = found.season;
  const [divisions, teams, leaders, windows] = await Promise.all([
    db
      .select({
        id: division.id,
        name: division.name,
        slug: division.slug,
        sortOrder: division.sortOrder,
        ruleSetId: division.ruleSetId,
        ruleSetName: ruleSet.name,
      })
      .from(division)
      .leftJoin(ruleSet, eq(ruleSet.id, division.ruleSetId))
      .where(eq(division.seasonId, s.id))
      .orderBy(asc(division.sortOrder), asc(division.name)),
    db
      .select({
        teamSeasonId: teamSeason.id,
        teamId: teamSeason.teamId,
        name: team.name,
        status: teamSeason.status,
        divisionId: teamSeason.divisionId,
        paymentMode: teamSeason.paymentMode,
        targetRosterSize: teamSeason.targetRosterSize,
        vibe: teamSeason.vibe,
      })
      .from(teamSeason)
      .innerJoin(team, eq(team.id, teamSeason.teamId))
      .where(eq(teamSeason.seasonId, s.id))
      .orderBy(asc(team.name)),
    db
      .select({
        teamSeasonId: rosterMembership.teamSeasonId,
        userId: registration.userId,
        role: rosterMembership.role,
        firstName: profile.firstName,
        lastName: profile.lastName,
        fallback: user.name,
      })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(registration.id, rosterMembership.registrationId),
      )
      .innerJoin(user, eq(user.id, registration.userId))
      .leftJoin(profile, eq(profile.userId, registration.userId))
      .innerJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
      .where(
        and(
          eq(teamSeason.seasonId, s.id),
          eq(rosterMembership.status, "active"),
          or(
            eq(rosterMembership.role, "captain"),
            eq(rosterMembership.role, "co_captain"),
          ),
          // A deleted account is never brought back.
          not(like(user.email, "%@deleted.invalid")),
        ),
      )
      .orderBy(asc(rosterMembership.role)),
    db
      .select({
        id: permitWindow.id,
        fieldId: permitWindow.fieldId,
        fieldName: field.name,
        venueName: venue.name,
        startsAt: permitWindow.startsAt,
        endsAt: permitWindow.endsAt,
        status: permitWindow.status,
      })
      .from(permitWindow)
      .innerJoin(field, eq(field.id, permitWindow.fieldId))
      .innerJoin(venue, eq(venue.id, field.venueId))
      .where(eq(permitWindow.seasonId, s.id))
      .orderBy(asc(permitWindow.startsAt), asc(field.name)),
  ]);
  // Someone suspended for good does not captain again.
  const suspended = await suspendedAmong(
    db,
    leaders.map((l) => l.userId),
    now,
  );
  const barred = new Set(
    [...suspended.entries()]
      .filter(([, mark]) => mark.length.scope === "permanent")
      .map(([id]) => id),
  );
  const sourceTeams: (SourceTeam & {
    teamId: TeamId;
    paymentMode: "full" | "split";
    targetRosterSize: number | null;
    vibe: string | null;
    leftOut: string[];
  })[] = teams.map((t) => {
    const mine = leaders.filter((l) => l.teamSeasonId === t.teamSeasonId);
    return {
      ...t,
      captains: mine
        .filter((l) => !barred.has(l.userId))
        .flatMap((l) =>
          l.role === "captain" || l.role === "co_captain"
            ? [{ userId: l.userId, name: nameOf(l), role: l.role }]
            : [],
        ),
      leftOut: mine.filter((l) => barred.has(l.userId)).map(nameOf),
    };
  });
  return {
    season: s,
    timeZone: found.timeZone,
    divisions,
    teams: sourceTeams,
    windows: windows.map((w) => ({
      ...w,
      fieldName: `${w.venueName}, ${w.fieldName}`,
    })),
  };
}

export type RolloverSource = NonNullable<
  Awaited<ReturnType<typeof rolloverSource>>
>;

/** The plan for a choice, from a loaded source. */
export function rolloverPlan(
  source: RolloverSource,
  choice: RolloverChoice,
): Result<RolloverPlan, RolloverProblem> {
  return planRollover(
    source.season,
    source.teams,
    source.windows,
    choice,
    source.timeZone,
  );
}

/**
 * Writes the new draft season. Run inside a transaction. The season is a
 * draft, so players see nothing until an admin opens registration.
 */
export async function rollOver(
  db: Db,
  input: { leagueId: LeagueId; slug: string; choice: RolloverChoice },
  actorId: UserId,
  now: Date,
): Promise<
  Result<
    { slug: string; teams: number; captains: number; windows: number },
    RolloverProblem | "unknown_season" | "duplicate"
  >
> {
  const source = await rolloverSource(db, input.leagueId, input.slug, now);
  if (!source) return err("unknown_season");
  const planned = rolloverPlan(source, input.choice);
  if (!planned.ok) return planned;
  const plan = planned.value;
  const [taken] = await db
    .select({ id: season.id })
    .from(season)
    .where(
      and(eq(season.leagueId, input.leagueId), eq(season.slug, plan.slug)),
    );
  if (taken) return err("duplicate");

  const s = source.season;
  const [created] = await db
    .insert(season)
    .values({
      leagueId: input.leagueId,
      name: plan.name,
      slug: plan.slug,
      status: "draft",
      ...plan.dates,
      feeModel: s.feeModel,
      teamFeeCents: s.teamFeeCents,
      playerFeeCents: s.playerFeeCents,
      freeAgentFeeCents: s.freeAgentFeeCents,
      earlyBirdDiscountCents: s.earlyBirdDiscountCents,
      maxTeams: s.maxTeams,
      rosterMin: s.rosterMin,
      rosterMax: s.rosterMax,
      gamesPerTeamPerDay: s.gamesPerTeamPerDay,
      minimumAge: s.minimumAge,
      waiverId: s.waiverId,
      fieldingRules: s.fieldingRules,
      tiebreakers: s.tiebreakers,
      rebatePolicy: s.rebatePolicy,
      crossoverGames: s.crossoverGames,
      crossoversCount: s.crossoversCount,
      combinedFinal: s.combinedFinal,
      createdBy: actorId,
    })
    .returning({ id: season.id });
  const seasonId: SeasonId = required(created, "season").id;

  // Divisions, with their rule sets, mapped old id → new id.
  const divisionIds = new Map<string, DivisionId>();
  if (source.divisions.length > 0) {
    const made = await db
      .insert(division)
      .values(
        source.divisions.map((d) => ({
          seasonId,
          name: d.name,
          slug: d.slug,
          ruleSetId: d.ruleSetId,
          sortOrder: d.sortOrder,
          createdBy: actorId,
        })),
      )
      .returning({ id: division.id, slug: division.slug });
    for (const d of source.divisions) {
      const twin = made.find((m) => m.slug === d.slug);
      if (twin) divisionIds.set(d.id, twin.id);
    }
  }

  // Teams, as forming: each still needs its players, waivers and fee.
  const teams = source.teams.filter((t) =>
    plan.teams.some((p) => p.teamSeasonId === t.teamSeasonId),
  );
  const entries = teams.length
    ? await db
        .insert(teamSeason)
        .values(
          teams.map((t) => ({
            teamId: t.teamId,
            seasonId,
            status: "forming" as const,
            paymentMode: t.paymentMode,
            targetRosterSize: t.targetRosterSize,
            vibe: t.vibe,
            divisionId: t.divisionId
              ? (divisionIds.get(t.divisionId) ?? null)
              : null,
            createdBy: actorId,
          })),
        )
        .returning({ id: teamSeason.id, teamId: teamSeason.teamId })
    : [];
  const entryOf = new Map<string, TeamSeasonId>(
    entries.map((e) => [e.teamId, e.id]),
  );

  // Captains and co-captains: a fresh registration (waiver and payment
  // still to do) and the same role on the same team.
  const leaders = teams.flatMap((t) =>
    t.captains.flatMap((c) => {
      const teamSeasonId = entryOf.get(t.teamId);
      const userId = parseId<UserId>(c.userId);
      return teamSeasonId && userId ? [{ ...c, userId, teamSeasonId }] : [];
    }),
  );
  if (leaders.length > 0) {
    const registrations = await db
      .insert(registration)
      .values(
        leaders.map((l) => ({
          seasonId,
          userId: l.userId,
          kind: "team_member" as const,
          status: "pending_waiver" as const,
          createdBy: actorId,
        })),
      )
      .returning({ id: registration.id, userId: registration.userId });
    await db.insert(rosterMembership).values(
      leaders.map((l) => ({
        teamSeasonId: l.teamSeasonId,
        registrationId: required(
          registrations.find((r) => r.userId === l.userId),
          "registration",
        ).id,
        role: l.role,
        status: "active" as const,
        startedAt: now,
        createdBy: actorId,
      })),
    );
  }

  // Permit windows: the same fields and hours on the new dates, to apply for.
  const fieldOf = new Map<string, FieldId>(
    source.windows.map((w) => [w.id, w.fieldId]),
  );
  if (plan.windows.length > 0)
    await db.insert(permitWindow).values(
      plan.windows.flatMap((w) => {
        const fieldId = fieldOf.get(w.id);
        return fieldId
          ? [
              {
                fieldId,
                seasonId,
                startsAt: w.newStartsAt,
                endsAt: w.newEndsAt,
                status: "requested" as const,
                createdBy: actorId,
              },
            ]
          : [];
      }),
    );

  await recordAudit(db, {
    actorId,
    action: "season.rollover",
    entityType: "season",
    entityId: seasonId,
    before: { fromSeasonId: s.id, fromSlug: s.slug },
    after: {
      name: plan.name,
      slug: plan.slug,
      startsOn: plan.dates.startsOn,
      endsOn: plan.dates.endsOn,
      days: plan.days,
      divisions: source.divisions.length,
      teams: entries.length,
      captains: leaders.length,
      permitWindows: plan.windows.length,
    },
  });
  return ok({
    slug: plan.slug,
    teams: entries.length,
    captains: leaders.length,
    windows: plan.windows.length,
  });
}

/** Seasons the league already has with these slugs, for the preview's warning. */
export async function slugInUse(db: Db, leagueId: LeagueId, slug: string) {
  const [found] = await db
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), eq(season.slug, slug)));
  return found !== undefined;
}
