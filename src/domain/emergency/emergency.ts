/**
 * Emergency contacts on game day (product-spec.md, "Accounts and
 * profile"; docs/adr/0043-emergency-contacts-sealed-and-shown-on-game-day.md).
 *
 * Each player keeps one emergency contact (name, relationship, phone) and
 * may add a short first-aid note. The league stores it sealed, and shows it
 * to nobody but the player, except on the day of one of their games: then
 * that game's captains and its ref can read it, so whoever is at the field
 * can call someone if a player is hurt. Pure: callers pass the time.
 */

import { recordOf } from "../guards";
import { normalizePhone } from "../profile/profile-form";
import { localDate } from "../scheduler/slots";

export const NAME_MAX = 120;
export const RELATIONSHIP_MAX = 40;
export const FIRST_AID_MAX = 300;

export const EMERGENCY_FIELDS = [
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
  "firstAidNote",
] as const;
export type EmergencyField = (typeof EMERGENCY_FIELDS)[number];
export type EmergencyForm = Record<EmergencyField, string>;
export type EmergencyErrors = Partial<Record<EmergencyField, string>>;

/** What the league keeps, sealed. */
export type EmergencyCard = {
  name: string;
  relationship: string | null;
  /** E.164. */
  phone: string;
  firstAid: string | null;
};

/**
 * Checks the emergency contact part of the profile form. Name and phone
 * are needed before registration; the relationship and first-aid note are
 * optional. `ownPhone` is the player's own number, which can't be theirs.
 */
export function parseEmergencyForm(
  form: EmergencyForm,
  ownPhone: string | null,
): { ok: true; value: EmergencyCard } | { ok: false; errors: EmergencyErrors } {
  const f = recordOf(EMERGENCY_FIELDS, (k) => form[k].trim());
  const errors: EmergencyErrors = {};
  if (f.emergencyContactName === "" || f.emergencyContactName.length > NAME_MAX)
    errors.emergencyContactName = "Enter who we should call.";
  if (f.emergencyContactRelationship.length > RELATIONSHIP_MAX)
    errors.emergencyContactRelationship = `Keep it under ${RELATIONSHIP_MAX} characters, such as “partner” or “sister”.`;
  const phone = normalizePhone(f.emergencyContactPhone);
  if (!phone)
    errors.emergencyContactPhone =
      "Enter a phone number, such as (718) 555-0123.";
  else if (phone === ownPhone)
    errors.emergencyContactPhone =
      "Use someone else's number, so we can reach them if you are hurt.";
  if (f.firstAidNote.length > FIRST_AID_MAX)
    errors.firstAidNote = `Keep the note under ${FIRST_AID_MAX} characters.`;
  if (Object.keys(errors).length > 0 || !phone) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: f.emergencyContactName,
      relationship: f.emergencyContactRelationship || null,
      phone,
      firstAid: f.firstAidNote || null,
    },
  };
}

/** A saved card back into form values; nothing saved is blank. */
export function toEmergencyForm(
  card: EmergencyCard | null,
  formatPhone: (e164: string) => string,
): EmergencyForm {
  return {
    emergencyContactName: card?.name ?? "",
    emergencyContactRelationship: card?.relationship ?? "",
    emergencyContactPhone: card ? formatPhone(card.phone) : "",
    firstAidNote: card?.firstAid ?? "",
  };
}

/** The card as the text that is sealed. */
export const cardText = (card: EmergencyCard): string => JSON.stringify(card);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown): v is string | null =>
  v === null || typeof v === "string";

/** A card from its opened text, or null when it isn't one. */
export function readCard(text: string): EmergencyCard | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { name, relationship, phone, firstAid } = value;
  if (
    typeof name !== "string" ||
    typeof phone !== "string" ||
    !textOrNull(relationship) ||
    !textOrNull(firstAid)
  )
    return null;
  return { name, relationship, phone, firstAid };
}

/** The game, as the visibility rule reads it. */
export type GameDayFacts = {
  status: string;
  /** Kickoff; null while the game has no slot. */
  startsAt: Date | null;
  timeZone: string;
};

/** The viewer's part in the game. */
export type Viewer = { captainsGame: boolean; refereesGame: boolean };

export type Hidden = "not_yours" | "not_game_day" | "called_off";

/**
 * Whether a viewer may read the game's emergency contacts at `now`: only
 * the game's captains (and co-captains) and its ref, and only on the
 * game's day in the league's time zone. Nobody else, admins included, and
 * never for a game called off or not yet placed.
 */
export function cardsVisible(
  game: GameDayFacts,
  viewer: Viewer,
  now: Date,
): { ok: true; until: Date } | { ok: false; error: Hidden } {
  if (!viewer.captainsGame && !viewer.refereesGame)
    return { ok: false, error: "not_yours" };
  if (
    game.status === "cancelled" ||
    game.status === "postponed" ||
    game.startsAt === null
  )
    return { ok: false, error: "called_off" };
  const day = localDate(game.startsAt, game.timeZone);
  if (localDate(now, game.timeZone) !== day)
    return { ok: false, error: "not_game_day" };
  return { ok: true, until: startOfNextDay(day, game.timeZone) };
}

/** Midnight at the end of `day` (YYYY-MM-DD) in `timeZone`, as an instant. */
export function startOfNextDay(day: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const target = next.toISOString().slice(0, 10);
  // Start from UTC midnight and step by the zone's offset until the local
  // date and time read target, 00:00. Two steps cover any offset change.
  let guess = next.getTime();
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");
    const local = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
    );
    const want = Date.parse(`${target}T00:00:00Z`);
    if (local === want) break;
    guess += want - local;
  }
  return new Date(guess);
}
