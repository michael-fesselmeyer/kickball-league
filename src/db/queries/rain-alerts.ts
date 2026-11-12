import { and, eq, gt, inArray, like, lte, ne, or } from "drizzle-orm";
import type { SeasonId, UserId } from "@/domain/ids";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import {
  ALERT_AHEAD_MS,
  type DayRisk,
  dueForRainCheck,
  type ForecastHour,
  type RainRisk,
  rainRisk,
  type Window,
} from "@/domain/weather/forecast";
import type { RainAlertPayload } from "@/emails/rain-alert";
import { user } from "../schema/auth";
import { field, game, slot, venue } from "../schema/game";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { gamePlacement, scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/**
 * Rain alerts (docs/architecture.md, section 7): about 24 hours before a
 * game day, admins hear whether rain is worth watching or likely, with a
 * link to the rain-out screen for that day. Each admin gets each level once
 * per game day, so a "watch" can be followed by "likely" but nothing repeats.
 */

export type GameDay = {
  seasonId: SeasonId;
  seasonSlug: string;
  seasonName: string;
  timeZone: string;
  /** YYYY-MM-DD in the league's time zone, as the rain-out screen names it. */
  date: string;
  firstPitch: Date;
  games: (Window & { lat: number; lng: number })[];
};

/**
 * Game days whose first game still to play starts within the alert's reach
 * of `now`, from each season's published schedule. Games at a venue with no
 * map pin cannot have a forecast and are left out.
 */
export async function gameDaysDue(db: Db, now: Date): Promise<GameDay[]> {
  // A whole day past the reach, so a day's later games come along with its
  // first one.
  const until = new Date(now.getTime() + ALERT_AHEAD_MS + 86_400_000);
  const rows = await db
    .select({
      seasonId: season.id,
      seasonSlug: season.slug,
      seasonName: season.name,
      timeZone: league.timezone,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      lat: venue.lat,
      lng: venue.lng,
    })
    .from(gamePlacement)
    .innerJoin(
      scheduleVersion,
      and(
        eq(gamePlacement.scheduleVersionId, scheduleVersion.id),
        eq(scheduleVersion.status, "published"),
      ),
    )
    .innerJoin(game, eq(gamePlacement.gameId, game.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .innerJoin(slot, eq(gamePlacement.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(
      and(
        ne(season.status, "draft"),
        eq(game.status, "scheduled"),
        eq(slot.status, "open"),
        gt(slot.startsAt, now),
        lte(slot.startsAt, until),
      ),
    );

  const days = new Map<string, GameDay>();
  for (const r of rows) {
    if (r.lat === null || r.lng === null) continue;
    const date = localDay(r.startsAt, r.timeZone);
    const key = `${r.seasonId}/${date}`;
    const day = days.get(key) ?? {
      seasonId: r.seasonId,
      seasonSlug: r.seasonSlug,
      seasonName: r.seasonName,
      timeZone: r.timeZone,
      date,
      firstPitch: r.startsAt,
      games: [],
    };
    if (r.startsAt < day.firstPitch) day.firstPitch = r.startsAt;
    day.games.push({
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      lat: Number(r.lat),
      lng: Number(r.lng),
    });
    days.set(key, day);
  }
  return [...days.values()]
    .filter((d) => dueForRainCheck(d.firstPitch, now))
    .sort((a, b) => a.firstPitch.getTime() - b.firstPitch.getTime());
}

/** The hourly forecast for a place, or null when there is none to be had. */
export type ForecastLookup = (
  lat: number,
  lng: number,
) => Promise<ForecastHour[] | null>;

export type RainCheck = { day: GameDay; risk: DayRisk };

const RANK: Record<RainRisk, number> = { low: 0, watch: 1, likely: 2 };

/** Each game day's risk, over the hours its games are on, place by place. */
export async function checkRain(
  days: readonly GameDay[],
  forecast: ForecastLookup,
): Promise<RainCheck[]> {
  const byPlace = new Map<string, Promise<ForecastHour[] | null>>();
  const hoursAt = (lat: number, lng: number) => {
    const key = `${lat},${lng}`;
    const known = byPlace.get(key);
    if (known) return known;
    const found = forecast(lat, lng);
    byPlace.set(key, found);
    return found;
  };
  const checks: RainCheck[] = [];
  for (const day of days) {
    const risk: DayRisk = {
      level: "low",
      peakChance: 0,
      thunder: false,
      covered: 0,
    };
    for (const place of new Set(day.games.map((g) => `${g.lat},${g.lng}`))) {
      const games = day.games.filter((g) => `${g.lat},${g.lng}` === place);
      const first = games[0];
      if (!first) continue;
      const hours = await hoursAt(first.lat, first.lng);
      if (!hours) continue;
      const here = rainRisk(hours, games);
      if (RANK[here.level] > RANK[risk.level]) risk.level = here.level;
      risk.peakChance = Math.max(risk.peakChance, here.peakChance);
      risk.thunder ||= here.thunder;
      risk.covered += here.covered;
    }
    checks.push({ day, risk });
  }
  return checks;
}

/** Everyone who can call a rain-out. */
async function admins(db: Db): Promise<UserId[]> {
  const rows = await db
    .select({ id: user.id })
    .from(profile)
    .innerJoin(user, eq(profile.userId, user.id))
    .where(inArray(profile.globalRole, ["admin", "owner"]));
  return rows.map((r) => r.id);
}

const keyPrefix = (day: GameDay) => `rain-alert/${day.seasonId}/${day.date}`;

/**
 * Queues an alert to every admin for each game day on watch or likely. The
 * dedupe key names the day, the level and the admin, so running the job
 * again is harmless. A watch after a likely alert for the same day is
 * skipped. Returns how many were new.
 */
export async function queueRainAlerts(
  db: Db,
  checks: readonly RainCheck[],
  now: Date,
): Promise<number> {
  const alerting = checks.filter(
    (c) => c.risk.level !== "low" && c.risk.covered > 0,
  );
  if (alerting.length === 0) return 0;
  const recipients = await admins(db);
  if (recipients.length === 0) return 0;
  const likelySent = new Set(
    (
      await db
        .select({ key: message.dedupeKey })
        .from(message)
        .where(
          or(
            ...alerting.map((c) =>
              like(message.dedupeKey, `${keyPrefix(c.day)}/likely/%`),
            ),
          ),
        )
    ).map((r) => r.key),
  );

  const messages: OutboxMessage[] = [];
  for (const { day, risk } of alerting) {
    const level = risk.level === "likely" ? "likely" : "watch";
    const payload = {
      seasonName: day.seasonName,
      seasonSlug: day.seasonSlug,
      date: day.date,
      day: shortDay(day.firstPitch, day.timeZone),
      firstPitch: kickoff(day.firstPitch, day.timeZone),
      games: day.games.length,
      level,
      peakChance: risk.peakChance,
      thunder: risk.thunder,
    } satisfies RainAlertPayload;
    for (const userId of recipients) {
      if (
        level === "watch" &&
        likelySent.has(`${keyPrefix(day)}/likely/${userId}`)
      )
        continue;
      messages.push({
        userId,
        topic: "rainout",
        template: "rain_alert",
        payload,
        dedupeKey: `${keyPrefix(day)}/${level}/${userId}`,
        sendAfter: now,
      });
    }
  }
  return enqueueMessages(db, messages);
}
