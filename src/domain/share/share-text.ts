import { kickoff, shortDay } from "../schedule/format";
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

/** A wa.me link that opens WhatsApp with the message filled in. */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** "Sun, Nov 16, 1:00 PM", or null when the game has no time yet. */
function when(g: PublicGame, timeZone: string): string | null {
  return g.startsAt
    ? `${shortDay(g.startsAt, timeZone)}, ${kickoff(g.startsAt, timeZone)}`
    : null;
}

/** A game's result, rain-out or matchup, with its link. */
export function gameShareText(
  g: PublicGame,
  { url, timeZone }: { url: string; timeZone: string },
): string {
  const matchup = `${g.teamA.name} vs ${g.teamB.name}`;
  const time = when(g, timeZone);
  const place = placeLine(g);
  const result = resultLine(g);
  let lines: (string | null)[];
  if (result) {
    lines = [
      `${statusLabel(g)}: ${bold(result)}`,
      g.startsAt ? shortDay(g.startsAt, timeZone) : null,
    ];
  } else if (isCalledOff(g)) {
    lines = [
      `${statusLabel(g)}: ${bold(matchup)}${time ? ` (${time})` : ""} is off.`,
      "The makeup goes on the schedule as soon as the league sets it.",
    ];
  } else if (g.status === "in_progress") {
    lines = [`Live now: ${bold(matchup)}`, place];
  } else {
    lines = [
      `Game on: ${bold(matchup)}`,
      time ?? "Time to be announced",
      place,
    ];
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
export function teamShareText(t: TeamShare): string {
  const record =
    t.record && t.record.wins + t.record.losses + t.record.ties > 0
      ? ` · ${t.record.wins}-${t.record.losses}-${t.record.ties}`
      : "";
  return [
    `${bold(t.name)}${t.seasonName ? ` · ${t.seasonName}` : ""}${record}`,
    "Schedule, results and a calendar feed:",
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
}: {
  title: string;
  kind: string;
  when: string;
  place: string | null;
  /** "Sun Kickers and Foul Play, Fall 2026", or null for a public event. */
  audience: string | null;
  invite: { host: string; url: string } | null;
  url: string;
  cancelled: boolean;
}): string {
  if (cancelled)
    return [`Called off: ${bold(title)} (${when})`, url].join("\n");
  return [
    `${bold(title)} · ${kind}`,
    when,
    place,
    audience ? `For ${audience}` : null,
    invite ? `RSVP on ${invite.host}: ${invite.url}` : null,
    url,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
