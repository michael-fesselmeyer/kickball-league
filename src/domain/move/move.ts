/**
 * "Looking for a change": a player quietly open to a new team next season
 * (product-spec.md, section 5; ADR 0081). Pure rules; src/db/queries/move.ts
 * reads and writes the rows.
 *
 * - Private from every team the player has played on: their captains,
 *   co-captains and teammates never see it, in any page, export or message.
 *   Nothing public shows it.
 * - The player picks who can see it: admins, captains recruiting for next
 *   season, or both. Admins see the name and note; the matcher reads it too.
 * - Double opt-in: a recruiting captain sees only how many players are open
 *   and can invite them all at once. A name reaches a team only when that
 *   player accepts its invite.
 * - It clears itself when a league season's registration closes after it
 *   was set (that is next season's), and the player can withdraw it.
 * - It never asks why.
 */

import { err, ok, type Result } from "../result";

export const AUDIENCES = ["admins", "captains", "both"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Longest note, in characters (the column's check matches). */
export const NOTE_MAX = 140;
/** Longest pitch a team sends with its invite. */
export const MESSAGE_MAX = 300;

/** The audience as the player chose it, or null when the form was tampered with. */
export function readAudience(raw: unknown): Audience | null {
  return AUDIENCES.find((a) => a === raw) ?? null;
}

function readText<E extends string>(
  raw: unknown,
  max: number,
  tooLong: E,
): Result<string | null, E> {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length === 0) return ok(null);
  if (text.length > max) return err(tooLong);
  return ok(text);
}

/** The optional note: trimmed, empty as none, at most NOTE_MAX. */
export const readNote = (raw: unknown) =>
  readText(raw, NOTE_MAX, "note_too_long");

/** A team's optional pitch: trimmed, empty as none, at most MESSAGE_MAX. */
export const readMessage = (raw: unknown) =>
  readText(raw, MESSAGE_MAX, "message_too_long");

export const seenByAdmins = (a: Audience) => a === "admins" || a === "both";
export const seenByCaptains = (a: Audience) => a === "captains" || a === "both";

/**
 * When a flag set at `setAt` clears: the first registration close after
 * it. `closings` are the league's seasons' closing times (a season with no
 * closing time closes when it starts). Null while no season ahead has one.
 */
export function clearsAt(
  setAt: Date,
  closings: readonly Date[],
): Date | null {
  let first: Date | null = null;
  for (const c of closings)
    if (c > setAt && (first === null || c < first)) first = c;
  return first;
}

/** Whether a flag set at `setAt` still counts at `now`. */
export function isActive(
  setAt: Date,
  closings: readonly Date[],
  now: Date,
): boolean {
  const clears = clearsAt(setAt, closings);
  return clears === null || clears > now;
}

/** Who looks at a flag, from where. */
export type Viewer =
  | { kind: "self" }
  | { kind: "admin" }
  | {
      kind: "recruiting_captain";
      /** The player has played for this captain's team, in any season. */
      playedForTeam: boolean;
      /** The team keeps the player off (ADR 0036). */
      keptOff: boolean;
    }
  | { kind: "other" };

/**
 * Whether `viewer` may count the flag (a captain) or read it (anyone
 * else). A team the player has played for never may, whatever the
 * audience, and neither may a team that keeps them off. Captains only ever
 * count it; the name needs the player's yes (`revealsName`).
 */
export function canSee(audience: Audience, viewer: Viewer): boolean {
  switch (viewer.kind) {
    case "self":
      return true;
    case "admin":
      return seenByAdmins(audience);
    case "recruiting_captain":
      return (
        seenByCaptains(audience) && !viewer.playedForTeam && !viewer.keptOff
      );
    case "other":
      return false;
  }
}

export type InviteStatus = "pending" | "accepted" | "declined";

/**
 * Whether a team learns who the player is: only after they accept its
 * invite, and only while their flag still lets captains see it.
 */
export const revealsName = (status: InviteStatus, audience: Audience) =>
  status === "accepted" && seenByCaptains(audience);

/** The season statuses in which a team is recruiting for it. */
export const RECRUITING = ["draft", "registration_open"] as const;

/** Whether a team entered in a season with this status and close is recruiting. */
export function isRecruiting(
  status: string,
  closesAt: Date | null,
  now: Date,
): boolean {
  return (
    (RECRUITING as readonly string[]).includes(status) &&
    (closesAt === null || closesAt > now)
  );
}
