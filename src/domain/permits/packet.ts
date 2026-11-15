/**
 * The application packet (ADR 0056): what NYC Parks may ask a league for,
 * in one place to copy or download. Parks' organization review can ask for
 * the website, rosters and schedule, and each borough is its own
 * application (docs/permits/nyc-parks.md). Player names go in only when an
 * owner chooses; otherwise the rosters are counts.
 */

import { distanceKm, type ParkField, type Point } from "../capacity/nearby";

/**
 * The borough of the NYC Parks park at a venue's pin: the nearest field in
 * the Open Data snapshot within half a kilometre, or null when none is.
 */
export function boroughAt(
  fields: readonly ParkField[],
  at: Point | null,
): string | null {
  if (!at) return null;
  let best: { borough: string; km: number } | null = null;
  for (const f of fields) {
    const km = distanceKm(at, f);
    if (km <= 0.5 && (!best || km < best.km)) best = { borough: f.borough, km };
  }
  return best?.borough ?? null;
}

export type PacketRow = {
  date: string;
  field: string;
  start: string;
  end: string;
};

export type PacketInput = {
  league: string;
  website: string;
  season: { name: string; startsOn: string; endsOn: string };
  /** One application per borough; `borough` is null when it isn't known. */
  applications: { borough: string | null; rows: PacketRow[] }[];
  counts: { teams: number; players: number; games: number; gameDays: number };
  /** Present only when an owner chose to include names. */
  rosters: { team: string; players: string[] }[] | null;
  insurance: {
    insurer: string;
    policyNumber: string | null;
    startsOn: string;
    expiresOn: string;
  } | null;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const dayOf = (on: string) =>
  WEEKDAYS[new Date(`${on}T12:00:00Z`).getUTCDay()] ?? "";

const hours = (rows: readonly PacketRow[]) => {
  const minutes = rows.reduce((t, r) => {
    const [sh = 0, sm = 0] = r.start.split(":").map(Number);
    const [eh = 0, em = 0] = r.end.split(":").map(Number);
    return t + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);
  return Math.round(minutes / 6) / 10;
};

/** Each borough's application, in the order Parks' boroughs sort. */
export function byBorough<T extends { borough: string | null }>(
  rows: readonly T[],
): { borough: string | null; rows: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const r of rows)
    groups.set(r.borough, [...(groups.get(r.borough) ?? []), r]);
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1,
    )
    .map(([borough, list]) => ({ borough, rows: list }));
}

/** The packet as plain text, for the copy button and the download. */
export function packetText(
  p: PacketInput,
  boroughName: (code: string) => string,
): string {
  const lines: string[] = [];
  const section = (title: string) => {
    if (lines.length > 0) lines.push("");
    lines.push(title.toUpperCase(), "");
  };
  section(`${p.league}: permit application packet for ${p.season.name}`);
  lines.push(`Season: ${p.season.startsOn} to ${p.season.endsOn}`);
  lines.push(`Website: ${p.website}`);

  section("Schedule and rosters");
  lines.push(`Teams: ${p.counts.teams}`);
  lines.push(`Players on rosters: ${p.counts.players}`);
  lines.push(`Games scheduled: ${p.counts.games} on ${p.counts.gameDays} days`);
  lines.push(
    "Games are scheduled, officiated league games with recorded results.",
  );

  for (const a of p.applications) {
    section(
      a.borough
        ? `${boroughName(a.borough)} application (${hours(a.rows)} field hours)`
        : `Application, borough not known (${hours(a.rows)} field hours)`,
    );
    for (const r of a.rows)
      lines.push(`${dayOf(r.date)} ${r.date}\t${r.field}\t${r.start}–${r.end}`);
  }

  section("Insurance");
  lines.push(
    p.insurance
      ? `${p.insurance.insurer}${p.insurance.policyNumber ? `, policy ${p.insurance.policyNumber}` : ""}: ${p.insurance.startsOn} to ${p.insurance.expiresOn}`
      : "No certificate on file.",
  );

  if (p.rosters) {
    section("Rosters");
    for (const t of p.rosters) {
      lines.push(`${t.team} (${t.players.length})`);
      for (const name of t.players) lines.push(`  ${name}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
