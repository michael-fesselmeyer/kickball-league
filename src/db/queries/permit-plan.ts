import { and, asc, eq, ne, sql } from "drizzle-orm";
import parkFields from "@/domain/capacity/nyc-park-fields.json";
import type { ParkField } from "@/domain/capacity/nearby";
import type { LeagueId, SeasonId } from "@/domain/ids";
import { NEAR_HOURS, INSURANCE_HOURS } from "@/domain/permits/hours";
import {
  permitPlan,
  type PermitPlan,
  type PlanWindow,
} from "@/domain/permits/plan";
import type { PermitAlertPayload } from "@/emails/permit-alert";
import { field, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { blackout, permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { groupKey } from "./books";
import { leagueUsersWithRole } from "./leagues";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * The reads behind the season's permit plan (ADR 0055): fee estimates, the
 * 50-hour insurance line and field time to give back. Two queries run
 * together, the windows with their slot counts and the blackouts; the
 * league's name and time zone come from the caller.
 */

const FIELDS = parkFields.fields as readonly ParkField[];

export async function planInputs(db: Db, seasonId: SeasonId) {
  const [rows, blackouts] = await Promise.all([
    db
      .select({
        id: permitWindow.id,
        fieldId: permitWindow.fieldId,
        fieldName: field.name,
        venueName: venue.name,
        lat: venue.lat,
        lng: venue.lng,
        startsAt: permitWindow.startsAt,
        endsAt: permitWindow.endsAt,
        status: permitWindow.status,
        permitNumber: permitWindow.permitNumber,
        costCents: permitWindow.costCents,
        slots: sql<number>`(select count(*)::int from ${slot} where ${slot.permitWindowId} = ${permitWindow.id})`,
        cancelledSlots: sql<number>`(select count(*)::int from ${slot} where ${slot.permitWindowId} = ${permitWindow.id} and ${slot.status} = 'cancelled')`,
      })
      .from(permitWindow)
      .innerJoin(field, eq(field.id, permitWindow.fieldId))
      .innerJoin(venue, eq(venue.id, field.venueId))
      .where(eq(permitWindow.seasonId, seasonId))
      .orderBy(asc(permitWindow.startsAt), asc(field.name)),
    db
      .select({ onDate: blackout.onDate, fieldId: blackout.fieldId })
      .from(blackout)
      .where(eq(blackout.seasonId, seasonId)),
  ]);
  const windows: PlanWindow[] = rows.map((r) => ({
    id: r.id,
    group: groupKey(r),
    fieldId: r.fieldId,
    fieldName: r.fieldName,
    venueName: r.venueName,
    venue:
      r.lat !== null && r.lng !== null
        ? { lat: Number(r.lat), lng: Number(r.lng) }
        : null,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    permitNumber: r.permitNumber,
    costCents: r.costCents,
    slots: r.slots,
    cancelledSlots: r.cancelledSlots,
  }));
  return {
    windows,
    blackouts: new Set(
      blackouts.map((b) => (b.fieldId ? `${b.onDate}/${b.fieldId}` : b.onDate)),
    ),
  };
}

/** The season's permit plan, for the permits screen and the books. */
export async function seasonPermitPlan(
  db: Db,
  seasonId: SeasonId,
  holder: { name: string; timeZone: string },
  now: Date,
): Promise<PermitPlan> {
  const inputs = await planInputs(db, seasonId);
  return permitPlan({
    ...inputs,
    parkFields: FIELDS,
    timeZone: holder.timeZone,
    now,
    holder: holder.name,
  });
}

/**
 * The daily job's permit alerts for every owner, each sent once: a season
 * nearing or passing NYC Parks' 50-hour insurance line, and each window of
 * field time coming up that the league won't use. Seasons that are over
 * are skipped. Returns how many were new.
 */
export async function queuePermitAlerts(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<number> {
  const [seasons, [about], owners] = await Promise.all([
    db
      .select({ id: season.id, name: season.name, slug: season.slug })
      .from(season)
      .where(
        and(eq(season.leagueId, leagueId), ne(season.status, "completed")),
      ),
    db
      .select({ name: league.name, timeZone: league.timezone })
      .from(league)
      .where(eq(league.id, leagueId)),
    // This league's owners (ADR 0048).
    leagueUsersWithRole(db, leagueId, ["owner"]),
  ]);
  if (!about || owners.length === 0 || seasons.length === 0) return 0;
  const plans = await Promise.all(
    seasons.map(async (s) => ({
      season: s,
      plan: await seasonPermitPlan(db, s.id, about, now),
    })),
  );
  const alerts: { key: string; payload: PermitAlertPayload }[] = [];
  for (const { season: s, plan } of plans) {
    if (plan.level !== "under")
      alerts.push({
        key: `permit-hours/${s.id}/${plan.level}`,
        payload: {
          kind: plan.level === "over" ? "hours_over" : "hours_near",
          season: s.name,
          seasonSlug: s.slug,
          hours: Math.round(plan.minutes / 6) / 10,
          line: plan.level === "over" ? INSURANCE_HOURS : NEAR_HOURS,
        },
      });
    for (const u of plan.unused)
      alerts.push({
        key: `permit-give-back/${u.windowId}/${u.reason}`,
        payload: {
          kind: "give_back",
          season: s.name,
          seasonSlug: s.slug,
          on: u.on,
          place: `${u.park}, ${u.field}`,
          hours: `${u.start}–${u.end}`,
          permitNumber: u.permitNumber,
          office: u.office,
        },
      });
  }
  if (alerts.length === 0) return 0;
  return enqueueMessages(
    db,
    alerts.flatMap((a) =>
      owners.map((id) => ({
        userId: id,
        topic: "operations" as const,
        template: "permit_alert",
        payload: a.payload,
        dedupeKey: `${a.key}/${id}`,
        sendAfter: now,
      })),
    ),
  );
}
