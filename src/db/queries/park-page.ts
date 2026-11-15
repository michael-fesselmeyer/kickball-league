import { and, asc, eq, gt } from "drizzle-orm";
import type { LeagueId, VenueId } from "@/domain/ids";
import type { ParkWindow } from "@/domain/parks/field-hours";
import { field, venue } from "../schema/game";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import type { Db } from "./schedule";
import { publicSeasons } from "./season-scope";

/**
 * What a park's public page reads: the venue, and the fields the league
 * holds there under a confirmed permit. Only the league's own seasons past
 * their draft count (ADR 0049), and only a permit's number, field, dates and
 * hours leave the building: its cost, its document and its renewal dates
 * stay with the owners.
 */

export type PublicPark = {
  id: VenueId;
  name: string;
  slug: string;
  address: string | null;
  neighborhood: string | null;
};

export async function publicParkBySlug(
  db: Db,
  leagueId: LeagueId,
  slug: string,
): Promise<PublicPark | null> {
  const [row] = await db
    .select({
      id: venue.id,
      name: venue.name,
      slug: venue.slug,
      address: venue.address,
      neighborhood: venue.neighborhood,
    })
    .from(venue)
    .where(and(eq(venue.leagueId, leagueId), eq(venue.slug, slug)))
    .limit(1);
  return row ?? null;
}

/**
 * The park's confirmed permit windows that end after `after`, soonest first.
 * A requested permit is not held yet and a lost one never was.
 */
export async function parkPermitWindows(
  db: Db,
  venueId: VenueId,
  after: Date,
): Promise<ParkWindow[]> {
  return db
    .select({
      fieldId: field.id,
      fieldName: field.name,
      sortOrder: field.sortOrder,
      startsAt: permitWindow.startsAt,
      endsAt: permitWindow.endsAt,
      permitNumber: permitWindow.permitNumber,
    })
    .from(permitWindow)
    .innerJoin(field, eq(permitWindow.fieldId, field.id))
    .innerJoin(season, eq(permitWindow.seasonId, season.id))
    .where(
      and(
        eq(field.venueId, venueId),
        eq(permitWindow.status, "confirmed"),
        gt(permitWindow.endsAt, after),
        publicSeasons,
      ),
    )
    .orderBy(asc(permitWindow.startsAt));
}

/** Every park of the league that has held a field in a public season. */
export async function publicParks(
  db: Db,
  leagueId: LeagueId,
): Promise<{ slug: string; updatedAt: Date }[]> {
  return db
    .selectDistinct({ slug: venue.slug, updatedAt: venue.updatedAt })
    .from(venue)
    .innerJoin(field, eq(field.venueId, venue.id))
    .innerJoin(permitWindow, eq(permitWindow.fieldId, field.id))
    .innerJoin(season, eq(permitWindow.seasonId, season.id))
    .where(
      and(
        eq(venue.leagueId, leagueId),
        eq(permitWindow.status, "confirmed"),
        publicSeasons,
      ),
    )
    .orderBy(asc(venue.slug));
}
