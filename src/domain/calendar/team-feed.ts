import {
  isCalledOff,
  placeLine,
  type PublicGame,
  resultLine,
  statusLabel,
} from "@/domain/schedule/public-game";
import { buildCalendar, type CalendarEvent } from "./ics";

export type TeamFeedInput = {
  teamName: string;
  /** The league's time zone. */
  timeZone: string;
  /** The site's origin, such as https://example.test, for game links. */
  origin: string;
  games: PublicGame[];
  now: Date;
};

/**
 * One calendar event per placed game. Unplaced games (makeups waiting for a
 * slot) have no time yet, so they wait until the schedule gives them one.
 */
export function gameEvent(g: PublicGame, origin: string): CalendarEvent | null {
  if (!g.startsAt || !g.endsAt) return null;
  const url = `${origin}/games/${g.id}`;
  const calledOff = isCalledOff(g);
  const label = statusLabel(g);
  const matchup = `${g.teamA.name} vs ${g.teamB.name}`;
  const result = resultLine(g);
  const description = [
    g.seasonName + (g.roundNo !== null ? `, round ${g.roundNo}` : ""),
    result ? `Final: ${result}` : null,
    calledOff && label
      ? `${label}. Check the game page for a makeup date.`
      : null,
    `Game page: ${url}`,
  ].filter((line): line is string => line !== null);
  const event: CalendarEvent = {
    uid: `game-${g.id}@kickball-league`,
    start: g.startsAt,
    end: g.endsAt,
    summary: calledOff && label ? `${label}: ${matchup}` : matchup,
    description: description.join("\n"),
    url,
    status: calledOff ? "CANCELLED" : "CONFIRMED",
    sequence: g.versionNo,
  };
  const place = placeLine(g);
  if (place) event.location = place;
  if (g.venue?.lat != null && g.venue.lng != null)
    event.geo = { lat: g.venue.lat, lng: g.venue.lng };
  return event;
}

/** A team's subscribed calendar: every placed game in its published schedules. */
export function teamFeed({
  teamName,
  timeZone,
  origin,
  games,
  now,
}: TeamFeedInput): string {
  return buildCalendar({
    name: `${teamName} games`,
    description: `Kickball games for ${teamName}. Updates when the league publishes a schedule change.`,
    timeZone,
    generatedAt: now,
    refreshMinutes: 60,
    events: games
      .map((g) => gameEvent(g, origin))
      .filter((e): e is CalendarEvent => e !== null),
  });
}
