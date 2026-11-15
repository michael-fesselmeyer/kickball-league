import { hkdfSync } from "node:crypto";
import { startOfNextDay } from "../emergency/emergency";
import { err, ok, type Result } from "../result";
import { localDate } from "../scheduler/slots";
import {
  checkinCode,
  codeTurnsOverAt,
  isCurrentCheckinCode,
} from "../sponsors/checkin-code";

/**
 * Field check-in (ADR 0063): who actually played in a game. At the field,
 * the game's ref or a captain shows a rotating QR code; players scan it and
 * tap Check in. A captain, the ref or an admin can also tick players in or
 * out, at the field or in the days after. Games played are counted from
 * these check-ins, for a season's playoff minimum.
 *
 * Pure rules, apart from deriving the code's key; src/db/queries/attendance.ts
 * reads and writes the rows. Callers pass the time.
 */

/**
 * The game's code key: derived from the server's auth secret and the game's
 * id, so nothing is stored, each game's code says nothing about another's,
 * and no code is valid for a sponsor or a giveaway.
 */
export function fieldCodeKey(authSecret: string, gameId: string): string {
  return Buffer.from(
    hkdfSync(
      "sha256",
      authSecret,
      "kickball-league/field-check-in",
      `field-check-in-v1:${gameId}`,
      32,
    ),
  ).toString("hex");
}

/** The code to show for a game at `at` (the sponsor code's rules, ADR 0016). */
export const fieldCode = (authSecret: string, gameId: string, at: Date) =>
  checkinCode(fieldCodeKey(authSecret, gameId), gameId, at);

/** Whether `code` is the game's current code or the one just before it. */
export const isCurrentFieldCode = (
  authSecret: string,
  gameId: string,
  code: string,
  now: Date,
) => isCurrentCheckinCode(fieldCodeKey(authSecret, gameId), gameId, code, now);

export { codeTurnsOverAt };

/** The parts of a game the windows below read. */
export type AttendanceGame = {
  status: string;
  /** Kickoff; null while the game has no slot. */
  startsAt: Date | null;
  timeZone: string;
};

export type ScanBlock = "called_off" | "not_game_day";

/**
 * Whether players can check themselves in at `now`: on the game's day in
 * the league's time zone, for a game that is placed and not called off.
 * Returns when scanning closes.
 */
export function scanOpen(
  game: AttendanceGame,
  now: Date,
): Result<{ until: Date }, ScanBlock> {
  if (
    game.status === "cancelled" ||
    game.status === "postponed" ||
    game.startsAt === null
  )
    return err("called_off");
  const day = localDate(game.startsAt, game.timeZone);
  if (localDate(now, game.timeZone) !== day) return err("not_game_day");
  return ok({ until: startOfNextDay(day, game.timeZone) });
}

/** How long after game day captains and the ref can still tick players. */
export const MARK_DAYS_AFTER = 7;
const DAY = 24 * 60 * 60 * 1000;

export type MarkBlock = "called_off" | "not_yet" | "closed";

/**
 * Whether attendance can be ticked at `now`: from the start of game day.
 * Captains and the ref have until MARK_DAYS_AFTER days after it, so a
 * captain with no signal at the field can do it later; admins have no end,
 * to correct the record.
 */
export function markOpen(
  game: AttendanceGame,
  now: Date,
  admin: boolean,
): Result<void, MarkBlock> {
  if (
    game.status === "cancelled" ||
    game.status === "postponed" ||
    game.startsAt === null
  )
    return err("called_off");
  const day = localDate(game.startsAt, game.timeZone);
  if (localDate(now, game.timeZone) < day) return err("not_yet");
  const closes =
    startOfNextDay(day, game.timeZone).getTime() + MARK_DAYS_AFTER * DAY;
  if (!admin && now.getTime() >= closes) return err("closed");
  return ok(undefined);
}

/** The ids ticked on the attendance form; each must be someone in the game. */
export function parseMarks(
  ticked: readonly string[],
  choices: ReadonlySet<string>,
): Result<Set<string>, "unknown_person"> {
  const marks = new Set(ticked);
  for (const id of marks) if (!choices.has(id)) return err("unknown_person");
  return ok(marks);
}

/** Who to add and who to take off, from the current list and the form's. */
export function attendanceChanges(
  current: ReadonlySet<string>,
  wanted: ReadonlySet<string>,
): { add: string[]; remove: string[] } {
  return {
    add: [...wanted].filter((id) => !current.has(id)).sort(),
    remove: [...current].filter((id) => !wanted.has(id)).sort(),
  };
}

/** The range a season's playoff minimum may take. */
export const LOWEST_PLAYOFF_MIN = 1;
export const HIGHEST_PLAYOFF_MIN = 30;

/** The season form's playoff minimum: empty for none, else 1 to 30. */
export function parsePlayoffMinGames(
  raw: string,
): Result<number | null, "bad_min"> {
  const v = raw.trim();
  if (v === "") return ok(null);
  if (!/^\d{1,2}$/.test(v)) return err("bad_min");
  const n = Number(v);
  return n >= LOWEST_PLAYOFF_MIN && n <= HIGHEST_PLAYOFF_MIN
    ? ok(n)
    : err("bad_min");
}

/**
 * Where a player stands against the season's playoff minimum, or null when
 * the season sets none.
 */
export function playoffStanding(
  played: number,
  minimum: number | null,
): { eligible: boolean; short: number } | null {
  if (minimum === null) return null;
  return { eligible: played >= minimum, short: Math.max(0, minimum - played) };
}
