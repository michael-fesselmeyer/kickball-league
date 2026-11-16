import { and, desc, eq } from "drizzle-orm";
import {
  daylightMargin,
  DEFAULT_DAYLIGHT_MARGIN_MINUTES,
  slotPastDaylight,
} from "@/domain/gameday/daylight";
import type { LeagueId, ScheduleVersionId, SeasonId } from "@/domain/ids";
import { division, ruleSet } from "../schema/division";
import { field, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/** What the schedule admin screen reads, apart from a version itself. */

/** A season of one league by its slug; slugs are unique within a league only. */
export async function seasonBySlug(
  db: Db,
  leagueId: LeagueId | null | undefined,
  slug: string,
) {
  if (!leagueId) return null;
  const [found] = await db
    .select({
      id: season.id,
      leagueId: season.leagueId,
      name: season.name,
      slug: season.slug,
      status: season.status,
      visibility: season.visibility,
      startsOn: season.startsOn,
      feeModel: season.feeModel,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(and(eq(season.leagueId, leagueId), eq(season.slug, slug)))
    .limit(1);
  return found ?? null;
}

/** One league's seasons, newest first, for its admins. */
export async function seasonsForAdmin(db: Db, leagueId: LeagueId) {
  return db
    .select({
      name: season.name,
      slug: season.slug,
      status: season.status,
      visibility: season.visibility,
    })
    .from(season)
    .where(eq(season.leagueId, leagueId))
    .orderBy(desc(season.startsOn));
}

export type VersionSummary = {
  id: ScheduleVersionId;
  versionNo: number;
  status: "draft" | "published" | "superseded";
  origin: string;
  violations: number;
  createdAt: Date;
  publishedAt: Date | null;
};

export async function versionsOf(
  db: Db,
  seasonId: SeasonId,
): Promise<VersionSummary[]> {
  const rows = await db
    .select({
      id: scheduleVersion.id,
      versionNo: scheduleVersion.versionNo,
      status: scheduleVersion.status,
      origin: scheduleVersion.origin,
      violations: scheduleVersion.violations,
      createdAt: scheduleVersion.createdAt,
      publishedAt: scheduleVersion.publishedAt,
    })
    .from(scheduleVersion)
    .where(eq(scheduleVersion.seasonId, seasonId))
    .orderBy(desc(scheduleVersion.versionNo));
  return rows.map((r) => ({
    ...r,
    violations: (r.violations as unknown[]).length,
  }));
}

/** Team names, and each slot's local date, time and field, for display. */
export async function scheduleLabels(
  db: Db,
  seasonId: SeasonId,
  timeZone: string,
) {
  const teams = await db
    .select({ id: teamSeason.id, name: team.name })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(teamSeason.seasonId, seasonId));
  const slots = await db
    .select({
      id: slot.id,
      startsAt: slot.startsAt,
      field: field.name,
      status: slot.status,
    })
    .from(slot)
    .innerJoin(field, eq(slot.fieldId, field.id))
    .where(eq(slot.seasonId, seasonId));
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    teams: new Map(teams.map((t) => [t.id as string, t.name])),
    slots: new Map(
      slots.map((s) => [
        s.id as string,
        {
          startsAt: s.startsAt,
          day: day.format(s.startsAt),
          time: time.format(s.startsAt),
          field: s.field,
          cancelled: s.status === "cancelled",
        },
      ]),
    ),
  };
}

export type DaylightRisk = {
  /** Minutes the slot runs past the end of daylight. */
  minutesShort: number;
  sunsetAt: Date;
};

/**
 * The season's open slots on fields without lights that run past the end of
 * daylight (issue #467), for the scheduler's warning: in spring and fall a
 * late slot runs into the dark. The margin before sunset is the largest any
 * of the season's rule sets asks for, so the warning errs on the safe side.
 * Two queries.
 */
export async function slotsPastDaylight(
  db: Db,
  seasonId: SeasonId,
  timeZone: string,
): Promise<Map<string, DaylightRisk>> {
  const [slots, rules] = await Promise.all([
    db
      .select({
        id: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        hasLights: field.hasLights,
        lat: venue.lat,
        lng: venue.lng,
      })
      .from(slot)
      .innerJoin(field, eq(slot.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .where(
        and(
          eq(slot.seasonId, seasonId),
          eq(slot.status, "open"),
          eq(field.hasLights, false),
        ),
      ),
    db
      .select({ options: ruleSet.options })
      .from(division)
      .innerJoin(ruleSet, eq(division.ruleSetId, ruleSet.id))
      .where(eq(division.seasonId, seasonId)),
  ]);
  const marginMinutes =
    rules.length === 0
      ? DEFAULT_DAYLIGHT_MARGIN_MINUTES
      : Math.max(...rules.map((r) => daylightMargin(r.options)));
  const out = new Map<string, DaylightRisk>();
  for (const s of slots) {
    const risk = slotPastDaylight({
      slotStartsAt: s.startsAt,
      slotEndsAt: s.endsAt,
      timeZone,
      at:
        s.lat !== null && s.lng !== null
          ? { lat: Number(s.lat), lng: Number(s.lng) }
          : null,
      hasLights: s.hasLights,
      marginMinutes,
    });
    if (risk) out.set(s.id, risk);
  }
  return out;
}
