/**
 * The printable game-day pack (issue #377): one sheet per field with its
 * games in order, a blank line score per game and the field's permit, plus
 * an optional check-in sheet per team. Pure layout; the page draws it and
 * src/db/queries/game-day-pack.ts reads it.
 */

/** The innings a line score has room for; the extra column covers the rest. */
export const PACK_INNINGS = [1, 2, 3, 4, 5, 6, 7] as const;

export type PermitStatus = "requested" | "confirmed" | "lost";

/** One game on the day, as read for the pack. */
export type PackRow = {
  id: string;
  startsAt: Date;
  fieldId: string;
  fieldName: string;
  venueName: string;
  teamA: string;
  teamB: string;
  teamAId: string;
  teamBId: string;
  /** "A" or "B" when the order is set, so the line score lists them in it. */
  kicksFirst: "A" | "B" | null;
  /** The accepted ref, first name and last initial. */
  referee: string | null;
  calledOff: boolean;
  permit: {
    number: string | null;
    status: PermitStatus;
    onFile: boolean;
  } | null;
};

export type PackGame = {
  id: string;
  startsAt: Date;
  /** The team that kicks first, then the other: the line score's rows. */
  first: string;
  second: string;
  referee: string | null;
  calledOff: boolean;
};

export type PermitNote = {
  number: string | null;
  status: PermitStatus;
  onFile: boolean;
};

export type FieldSheet = {
  fieldId: string;
  fieldName: string;
  venueName: string;
  games: PackGame[];
  /** The permits this field's games are played on, once each. */
  permits: PermitNote[];
  /** True when a game on the field came from no permit at all. */
  unpermitted: boolean;
};

/**
 * The day's sheets: one per field, fields in the order their first game
 * starts (then by name), games by kickoff.
 */
export function fieldSheets(rows: readonly PackRow[]): FieldSheet[] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.fieldName.localeCompare(b.fieldName),
  );
  const sheets = new Map<string, FieldSheet>();
  for (const row of sorted) {
    let sheet = sheets.get(row.fieldId);
    if (!sheet) {
      sheet = {
        fieldId: row.fieldId,
        fieldName: row.fieldName,
        venueName: row.venueName,
        games: [],
        permits: [],
        unpermitted: false,
      };
      sheets.set(row.fieldId, sheet);
    }
    const bFirst = row.kicksFirst === "B";
    sheet.games.push({
      id: row.id,
      startsAt: row.startsAt,
      first: bFirst ? row.teamB : row.teamA,
      second: bFirst ? row.teamA : row.teamB,
      referee: row.referee,
      calledOff: row.calledOff,
    });
    const permit = row.permit;
    if (!permit) sheet.unpermitted = true;
    else {
      const same = sheet.permits.find(
        (p) => p.number === permit.number && p.status === permit.status,
      );
      if (!same) sheet.permits.push({ ...permit });
      else same.onFile ||= permit.onFile;
    }
  }
  return [...sheets.values()];
}

/** What a sheet says about one permit, in plain words. */
export function permitLine(permit: PermitNote): string {
  const name = permit.number ? `Permit ${permit.number}` : "A permit";
  if (permit.status === "lost")
    return `${name} was lost. Check with an admin before play.`;
  const pending =
    permit.status === "requested" ? " (requested, not confirmed yet)" : "";
  const file = permit.onFile
    ? "Permit on file: the ref and captains can open it in the app."
    : "No copy of the permit on file yet.";
  return `${name}${pending}. ${file}`;
}

/** The teams playing on the day, once each, by name. */
export function teamsPlaying(
  rows: readonly PackRow[],
): { id: string; name: string }[] {
  const teams = new Map<string, string>();
  for (const row of rows) {
    if (row.calledOff) continue;
    teams.set(row.teamAId, row.teamA);
    teams.set(row.teamBId, row.teamB);
  }
  return [...teams]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Jo S.": first name and last initial, whatever the profile holds. */
export function checkInName(
  firstName: string | null,
  lastName: string | null,
  fallback: string | null,
): string {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first) return last ? `${first} ${last.charAt(0)}.` : first;
  // No profile name: the account name, cut to the same shape.
  const words = (fallback ?? "").trim().split(/\s+/).filter(Boolean);
  const [head, ...rest] = words;
  if (!head) return "A player";
  const tail = rest.at(-1);
  return tail ? `${head} ${tail.charAt(0)}.` : head;
}
