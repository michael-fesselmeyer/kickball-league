import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { PlanWindow } from "@/domain/capacity/plan";
import type { Point } from "@/domain/capacity/nearby";
import type { LeagueId, SeasonId } from "@/domain/ids";
import { localDate } from "@/domain/books/ledger-csv";
import { localTime } from "@/domain/time/zoned";
import { minutesOf } from "@/domain/books/request-sheet";
import { field, slot, venue } from "../schema/game";
import { blackout, permitWindow } from "../schema/schedule";
import { teamSeason } from "../schema/team";
import { waitlistEntry } from "../schema/waitlist";
import type { Db } from "./schedule";

export type CapacityField = {
  id: string;
  name: string;
  venueName: string;
  /** Permit windows on it this season. */
  windows: number;
};

export type CapacityInputs = {
  windows: PlanWindow[];
  blackouts: Set<string>;
  /** Teams in the season, not waitlisted or withdrawn. */
  entered: number;
  /** Teams waiting for a place: waitlisted entries and open waitlist spots. */
  waiting: number;
  /** The league's fields, the busiest this season first. */
  fields: CapacityField[];
  /** Where the league's parks are, for nearby fields. */
  parks: Point[];
  /** The most common regular slot length this season, if it has slots. */
  slotMinutes: number | null;
};

/**
 * What the capacity planner needs for one season, in five independent
 * queries run together: the windows not marked lost (as local dates and
 * minutes), the league-wide blackouts, the teams in and waiting, the
 * league's fields and parks, and the usual slot length.
 */
export async function capacityInputs(
  db: Db,
  leagueId: LeagueId,
  seasonId: SeasonId,
  timeZone: string,
): Promise<CapacityInputs> {
  const [windows, blackouts, teams, waitlist, fields, slots] =
    await Promise.all([
      db
        .select({
          fieldId: permitWindow.fieldId,
          startsAt: permitWindow.startsAt,
          endsAt: permitWindow.endsAt,
        })
        .from(permitWindow)
        .where(
          and(
            eq(permitWindow.seasonId, seasonId),
            ne(permitWindow.status, "lost"),
          ),
        )
        .orderBy(asc(permitWindow.startsAt)),
      db
        .select({ onDate: blackout.onDate })
        .from(blackout)
        .where(and(eq(blackout.seasonId, seasonId), isNull(blackout.fieldId))),
      db
        .select({
          waiting: sql<number>`count(*) filter (where ${teamSeason.status} = 'waitlisted')::int`,
          entered: sql<number>`count(*) filter (where ${teamSeason.status} not in ('waitlisted', 'withdrawn'))::int`,
        })
        .from(teamSeason)
        .where(eq(teamSeason.seasonId, seasonId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(waitlistEntry)
        .where(
          and(
            eq(waitlistEntry.seasonId, seasonId),
            inArray(waitlistEntry.status, ["waiting", "offered"]),
          ),
        ),
      db
        .select({
          id: field.id,
          name: field.name,
          venueName: venue.name,
          lat: venue.lat,
          lng: venue.lng,
          windows: sql<number>`(select count(*)::int from ${permitWindow} where ${permitWindow.fieldId} = ${field.id} and ${permitWindow.seasonId} = ${seasonId})`,
        })
        .from(field)
        .innerJoin(venue, eq(venue.id, field.venueId))
        .where(eq(venue.leagueId, leagueId))
        .orderBy(asc(venue.name), asc(field.sortOrder), asc(field.name)),
      db
        .select({
          minutes: sql<number>`(extract(epoch from ${slot.endsAt} - ${slot.startsAt}) / 60)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(slot)
        .where(and(eq(slot.seasonId, seasonId), eq(slot.kind, "regular")))
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`, sql`1 asc`)
        .limit(1),
    ]);

  const parks = new Map<string, Point>();
  for (const f of fields) {
    if (f.lat === null || f.lng === null) continue;
    parks.set(`${f.lat},${f.lng}`, { lat: Number(f.lat), lng: Number(f.lng) });
  }

  return {
    windows: windows.map((w) => {
      const start = minutesOf(localTime(w.startsAt, timeZone)) ?? 0;
      const end = minutesOf(localTime(w.endsAt, timeZone)) ?? 0;
      const sameDay =
        localDate(w.endsAt, timeZone) === localDate(w.startsAt, timeZone);
      return {
        date: localDate(w.startsAt, timeZone),
        fieldKey: w.fieldId,
        start,
        // A window past midnight counts up to midnight.
        end: sameDay ? end : 24 * 60,
      };
    }),
    blackouts: new Set(blackouts.map((b) => b.onDate)),
    entered: teams[0]?.entered ?? 0,
    waiting: (teams[0]?.waiting ?? 0) + (waitlist[0]?.count ?? 0),
    fields: fields
      .map(({ id, name, venueName, windows }) => ({
        id,
        name,
        venueName,
        windows,
      }))
      .sort((a, b) => b.windows - a.windows),
    parks: [...parks.values()],
    slotMinutes: slots[0]?.minutes ?? null,
  };
}
