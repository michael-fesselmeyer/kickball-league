import { dayHeading, kickoff, shortDay } from "../schedule/format";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import {
  isCalledOff,
  placeLine,
  type PublicGame,
  resultLine,
  statusLabel,
} from "../schedule/public-game";

/**
 * Ready-to-paste messages for the league's WhatsApp chats. WhatsApp shows
 * `*text*` as bold, so names are stripped of asterisks before being wrapped.
 */

/** Bold in WhatsApp, safe for names that contain asterisks. */
export const bold = (text: string): string =>
  `*${text.replaceAll("*", "").trim()}*`;

export { whatsappHref } from "./whatsapp";

/** "Sun, Nov 16, 1:00 PM", or null when the game has no time yet. */
function when(g: PublicGame, timeZone: string, locale: Locale): string | null {
  return g.startsAt
    ? `${shortDay(g.startsAt, timeZone, locale)}, ${kickoff(g.startsAt, timeZone, locale)}`
    : null;
}

/** A game's result, rain-out or matchup, with its link. */
export function gameShareText(
  g: PublicGame,
  {
    url,
    timeZone,
    locale = DEFAULT_LOCALE,
  }: { url: string; timeZone: string; locale?: Locale },
): string {
  const { game: words, stats } = messagesFor(locale);
  const matchup = bold(fill(stats.vs, { a: g.teamA.name, b: g.teamB.name }));
  const time = when(g, timeZone, locale);
  const place = placeLine(g);
  const result = resultLine(g, locale);
  const status = statusLabel(g, locale) ?? "";
  let lines: (string | null)[];
  if (result) {
    lines = [
      fill(words.shareResult, { status, result: bold(result) }),
      g.startsAt ? shortDay(g.startsAt, timeZone, locale) : null,
    ];
  } else if (isCalledOff(g)) {
    lines = [
      time
        ? fill(words.shareOffAt, { status, matchup, time })
        : fill(words.shareOff, { status, matchup }),
      words.shareMakeup,
    ];
  } else if (g.status === "in_progress") {
    lines = [fill(words.shareLive, { matchup }), place];
  } else {
    lines = [fill(words.shareOn, { matchup }), time ?? words.tba, place];
  }
  return [...lines.filter(Boolean), url].join("\n");
}

export type TeamShare = {
  name: string;
  seasonName: string | null;
  record: { wins: number; losses: number; ties: number } | null;
  url: string;
};

/** A team's season so far, with its link. */
export function teamShareText(
  t: TeamShare,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const record =
    t.record && t.record.wins + t.record.losses + t.record.ties > 0
      ? ` · ${t.record.wins}-${t.record.losses}-${t.record.ties}`
      : "";
  return [
    `${bold(t.name)}${t.seasonName ? ` · ${t.seasonName}` : ""}${record}`,
    messagesFor(locale).team.shareText,
    t.url,
  ].join("\n");
}

export type RainoutMove = {
  /** "Aces vs Bees" */
  teams: string;
  /** Where the makeup is, or null while it has no slot. */
  makeup: string | null;
};

/** A rain-out for one date, with each game's makeup and the schedule link. */
export function rainoutShareText({
  day,
  moves,
  url,
}: {
  day: string;
  moves: RainoutMove[];
  url: string;
}): string {
  return [
    `Rain-out: games on ${bold(day)} are off.`,
    ...(moves.length
      ? [
          "",
          "Makeups:",
          ...moves.map(
            (m) => `• ${m.teams}: ${m.makeup ?? "new time to come"}`,
          ),
        ]
      : []),
    "",
    `Full schedule: ${url}`,
  ].join("\n");
}

/**
 * One game day's schedule for the group chat: the day in bold, then each
 * game's kickoff, matchup and field in kickoff order, then the link to the
 * full schedule. Plain text, no emoji. Called-off games say so.
 */
export function gameDayShareText({
  seasonName,
  day,
  games,
  timeZone,
  url,
}: {
  seasonName: string;
  /** YYYY-MM-DD in the league's time zone. */
  day: string;
  games: readonly PublicGame[];
  timeZone: string;
  url: string;
}): string {
  const lines = games.map((g) => {
    const time = g.startsAt ? kickoff(g.startsAt, timeZone) : "Time TBA";
    const place = placeLine(g);
    const off = isCalledOff(g)
      ? ` (${(statusLabel(g) ?? "Off").toLowerCase()})`
      : "";
    return `${time}  ${g.teamA.name} vs ${g.teamB.name}${place ? `, ${place}` : ""}${off}`;
  });
  return [
    bold(`${seasonName}: ${dayHeading(day)}`),
    ...lines,
    "",
    `Full schedule: ${url}`,
  ].join("\n");
}

/** An announcement as one message: bold subject, then the body. */
export function announcementShareText({
  subject,
  body,
  url,
}: {
  subject: string;
  body: string;
  url?: string;
}): string {
  return [bold(subject), "", body.trim(), ...(url ? ["", url] : [])].join("\n");
}

/**
 * An event for a group chat: name and kind, when and where, who it's for
 * when it isn't open to everyone, the invite link and the event's page.
 */
export function eventShareText({
  title,
  kind,
  when,
  place,
  audience,
  invite,
  url,
  cancelled,
  locale = DEFAULT_LOCALE,
}: {
  title: string;
  kind: string;
  when: string;
  place: string | null;
  /** "Sun Kickers and Foul Play, Fall 2026", or null for a public event. */
  audience: string | null;
  invite: { site: string; url: string } | null;
  url: string;
  cancelled: boolean;
  /** The message's language (ADR 0094); English unless given. */
  locale?: Locale;
}): string {
  const words = messagesFor(locale);
  if (cancelled)
    return [
      fill(words.event.shareCalledOff, { title: bold(title), when }),
      url,
    ].join("\n");
  return [
    `${bold(title)} · ${kind}`,
    when,
    place,
    audience ? fill(words.event.shareFor, { audience }) : null,
    invite
      ? fill(words.email.event.rsvpOn, { site: invite.site, url: invite.url })
      : null,
    url,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
