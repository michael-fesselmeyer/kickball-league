import { createHash } from "node:crypto";
import {
  aliasedTable,
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import type { PermitAlertPayload } from "@/emails/permit-alert";
import type {
  EventId,
  FieldId,
  GameId,
  LeagueId,
  SeasonId,
} from "@/domain/ids";
import {
  type CoverageGap,
  type CoverWindow,
  coverageGap,
  gapSentence,
} from "@/domain/permits/coverage";
import type { SchedulerPermits } from "@/domain/scheduler/types";
import { fullWhen } from "@/domain/schedule/format";
import { event } from "../schema/event";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { ownerIds } from "./books";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Permit coverage in the database (issue #407): the windows the check in
 * src/domain/permits/coverage.ts judges against, and every upcoming game or
 * event at a park that no usable permit covers, for the permits screen and
 * the owners' email.
 */

/** A league's fields, "Field 3, McCarren Park", for the event form. */
export async function leagueFields(db: Db, leagueId: LeagueId) {
  const rows = await db
    .select({ id: field.id, name: field.name, venueName: venue.name })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(eq(venue.leagueId, leagueId))
    .orderBy(venue.name, field.sortOrder, field.name);
  return rows.map((r) => ({ id: r.id, label: `${r.name}, ${r.venueName}` }));
}

/** Every permit window on the given fields that ends after `from`. */
export async function coverWindows(
  db: Db,
  fieldIds: readonly FieldId[],
  from: Date,
): Promise<CoverWindow[]> {
  if (fieldIds.length === 0) return [];
  const rows = await db
    .select({
      fieldId: permitWindow.fieldId,
      startsAt: permitWindow.startsAt,
      endsAt: permitWindow.endsAt,
      status: permitWindow.status,
      documentFileId: permitWindow.documentFileId,
    })
    .from(permitWindow)
    .where(
      and(
        inArray(permitWindow.fieldId, [...fieldIds]),
        gt(permitWindow.endsAt, from),
      ),
    );
  return rows.map(({ documentFileId, ...w }) => ({
    ...w,
    hasDocument: documentFileId !== null,
  }));
}

/**
 * Whether a field of the league is covered for a span; the gap in words
 * when it isn't. For the forms that post something on a field.
 */
export async function checkCoverage(
  db: Db,
  input: {
    leagueId: LeagueId;
    fieldId: FieldId;
    startsAt: Date;
    endsAt: Date;
    noun: string;
    timeZone: string;
  },
): Promise<
  | { ok: true }
  | { ok: false; reason: "unknown_field" }
  | { ok: false; reason: "gap"; gap: CoverageGap; sentence: string }
> {
  const [f] = await db
    .select({ name: field.name })
    .from(field)
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(
      and(eq(field.id, input.fieldId), eq(venue.leagueId, input.leagueId)),
    );
  if (!f) return { ok: false, reason: "unknown_field" };
  const windows = await coverWindows(db, [input.fieldId], input.startsAt);
  const gap = coverageGap(input, windows);
  if (!gap) return { ok: true };
  return {
    ok: false,
    reason: "gap",
    gap,
    sentence: gapSentence(
      gap,
      {
        fieldName: f.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        noun: input.noun,
      },
      input.timeZone,
    ),
  };
}

/**
 * The permits the scheduler's H12 judges a season's games against: every
 * window on the season's fields, whatever season it was asked for under,
 * and only games from `now` on.
 */
export async function schedulerPermits(
  db: Db,
  seasonId: SeasonId,
  now: Date,
): Promise<SchedulerPermits> {
  const [s] = await db
    .select({ timeZone: league.timezone })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, seasonId));
  const fields = await db
    .selectDistinct({ id: field.id, name: field.name })
    .from(slot)
    .innerJoin(field, eq(slot.fieldId, field.id))
    .where(eq(slot.seasonId, seasonId));
  return {
    windows: await coverWindows(
      db,
      fields.map((f) => f.id),
      now,
    ),
    from: now.toISOString(),
    fieldNames: Object.fromEntries(fields.map((f) => [f.id, f.name])),
    timeZone: s?.timeZone ?? "America/New_York",
  };
}

/** An upcoming game or event at a park that no usable permit covers. */
export type Uncovered = {
  /** Stable across reads: "game:<id>" or "event:<id>". */
  key: string;
  kind: "game" | "event";
  id: GameId | EventId;
  title: string;
  startsAt: Date;
  endsAt: Date;
  place: string;
  gap: CoverageGap;
  sentence: string;
  /** Where an admin fixes it. */
  path: string;
};

const teamA = aliasedTable(team, "cover_team_a");
const teamB = aliasedTable(team, "cover_team_b");
const entryA = aliasedTable(teamSeason, "cover_entry_a");
const entryB = aliasedTable(teamSeason, "cover_entry_b");

/**
 * Every game still to play and every event posted on a field (not open
 * play, not called off) from `now` on, in a league, that no usable permit
 * covers. Three queries, whatever the number of items.
 */
export async function uncoveredItems(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<Uncovered[]> {
  const [l] = await db
    .select({ timeZone: league.timezone })
    .from(league)
    .where(eq(league.id, leagueId));
  const tz = l?.timeZone ?? "America/New_York";
  const [games, events] = await Promise.all([
    db
      .select({
        id: game.id,
        fieldId: slot.fieldId,
        fieldName: field.name,
        venueName: venue.name,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        seasonSlug: season.slug,
        teamA: teamA.name,
        teamB: teamB.name,
      })
      .from(game)
      .innerJoin(slot, eq(game.slotId, slot.id))
      .innerJoin(field, eq(slot.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .innerJoin(season, eq(game.seasonId, season.id))
      .innerJoin(entryA, eq(entryA.id, game.teamAId))
      .innerJoin(teamA, eq(teamA.id, entryA.teamId))
      .innerJoin(entryB, eq(entryB.id, game.teamBId))
      .innerJoin(teamB, eq(teamB.id, entryB.teamId))
      .where(
        and(
          eq(season.leagueId, leagueId),
          eq(game.status, "scheduled"),
          eq(slot.status, "open"),
          gte(slot.startsAt, now),
        ),
      ),
    db
      .select({
        id: event.id,
        slug: event.slug,
        title: event.title,
        fieldId: event.fieldId,
        fieldName: field.name,
        venueName: venue.name,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      })
      .from(event)
      .innerJoin(field, eq(event.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .where(
        and(
          eq(event.leagueId, leagueId),
          isNotNull(event.fieldId),
          eq(event.openPlay, false),
          isNull(event.cancelledAt),
          isNull(event.deletedAt),
          gte(event.endsAt, now),
        ),
      ),
  ]);
  const fieldIds = [
    ...new Set([
      ...games.map((g) => g.fieldId),
      ...events.flatMap((e) => (e.fieldId ? [e.fieldId] : [])),
    ]),
  ];
  const windows = await coverWindows(db, fieldIds, now);
  const out: Uncovered[] = [];
  for (const g of games) {
    const gap = coverageGap(g, windows);
    if (gap)
      out.push({
        key: `game:${g.id}`,
        kind: "game",
        id: g.id,
        title: `${g.teamA} vs ${g.teamB}`,
        startsAt: g.startsAt,
        endsAt: g.endsAt,
        place: `${g.venueName}, ${g.fieldName}`,
        gap,
        sentence: gapSentence(gap, { ...g, noun: "game" }, tz),
        path: `/app/admin/seasons/${g.seasonSlug}/schedule`,
      });
  }
  for (const e of events) {
    if (!e.fieldId) continue;
    const gap = coverageGap({ ...e, fieldId: e.fieldId }, windows);
    if (gap)
      out.push({
        key: `event:${e.id}`,
        kind: "event",
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        place: `${e.venueName}, ${e.fieldName}`,
        gap,
        sentence: gapSentence(gap, { ...e, noun: "event" }, tz),
        path: `/app/admin/events/${e.slug}`,
      });
  }
  return out.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.place.localeCompare(b.place),
  );
}

/** The most items one email lists; the permits screen has them all. */
const EMAIL_ITEMS = 10;

/**
 * After a permit is marked lost or a window removed: emails the owners
 * once about the items that were covered before (`before`, the keys
 * `uncoveredItems` returned then) and aren't now. Returns how many items
 * newly lost their cover. Call in the transaction that made the change.
 */
export async function tellOwnersOfNewGaps(
  db: Db,
  input: { leagueId: LeagueId; before: ReadonlySet<string>; now: Date },
): Promise<number> {
  const after = await uncoveredItems(db, input.leagueId, input.now);
  const fresh = after.filter((i) => !input.before.has(i.key));
  if (fresh.length === 0) return 0;
  const [l] = await db
    .select({ timeZone: league.timezone })
    .from(league)
    .where(eq(league.id, input.leagueId));
  const tz = l?.timeZone ?? "America/New_York";
  const payload: PermitAlertPayload = {
    kind: "uncovered",
    count: fresh.length,
    items: fresh.slice(0, EMAIL_ITEMS).map((i) => ({
      what: i.title,
      when: fullWhen(i.startsAt, tz),
      place: i.place,
      why: i.sentence,
    })),
  };
  // One email per change: the same items losing cover twice is one email.
  const digest = createHash("sha256")
    .update(fresh.map((i) => i.key).join(","))
    .digest("hex")
    .slice(0, 16);
  const owners = await ownerIds(db, input.leagueId);
  await enqueueMessages(
    db,
    owners.map((userId) => ({
      userId,
      topic: "operations" as const,
      template: "permit_alert",
      payload,
      dedupeKey: `uncovered/${digest}/${userId}`,
      sendAfter: input.now,
    })),
  );
  return fresh.length;
}

/** Keys of what is uncovered now, to pass to `tellOwnersOfNewGaps` later. */
export async function uncoveredKeys(
  db: Db,
  leagueId: LeagueId,
  now: Date,
): Promise<Set<string>> {
  return new Set((await uncoveredItems(db, leagueId, now)).map((i) => i.key));
}
