import { desc, eq } from "drizzle-orm";
import type { ScheduleVersionId, SeasonId } from "@/domain/ids";
import { field, slot } from "../schema/game";
import { league } from "../schema/league";
import { scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/** What the schedule admin screen reads, apart from a version itself. */

export async function seasonBySlug(db: Db, slug: string) {
  const [found] = await db
    .select({
      id: season.id,
      name: season.name,
      slug: season.slug,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.slug, slug))
    .limit(1);
  return found ?? null;
}

export async function seasonsForAdmin(db: Db) {
  return db
    .select({ name: season.name, slug: season.slug, status: season.status })
    .from(season)
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
