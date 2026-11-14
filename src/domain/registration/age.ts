import { isAtLeast } from "@/domain/profile/profile-form";
import { err, ok, type Result } from "@/domain/result";

/**
 * The league's age check (ADR 0041). Registering for a season and signing
 * its waiver each need the player to confirm they meet the minimum age: the
 * season's own, else the league's (21 unless the league changes it). The
 * profile already holds a birth date, which registration requires, so the
 * confirmation is checked against it; only the confirmation and the age it
 * confirmed are stored with the registration or signature. Pure: no clock
 * and no database.
 */

export const DEFAULT_MINIMUM_AGE = 21;
/** The law's floor for the waiver, and a sane ceiling for a typo. */
export const LOWEST_MINIMUM_AGE = 18;
export const HIGHEST_MINIMUM_AGE = 99;

/** The minimum age that applies to a season. */
export function minimumAgeFor(
  league: { minimumAge: number },
  season: { minimumAge: number | null },
): number {
  return season.minimumAge ?? league.minimumAge;
}

export type AgeRefusal = "age_unconfirmed" | "under_age";

/**
 * Whether a player may go on. A birth date on file that falls short of the
 * minimum refuses them even when they tick the box; with no birth date on
 * file, the confirmation stands on its own.
 */
export function checkAge(input: {
  confirmed: boolean;
  minimumAge: number;
  /** YYYY-MM-DD from the profile, or null when there is none. */
  birthDate: string | null;
  /** Today in the league's time zone, YYYY-MM-DD. */
  today: string;
}): Result<{ minimumAge: number }, AgeRefusal> {
  if (
    input.birthDate !== null &&
    !isAtLeast(input.minimumAge, input.birthDate, input.today)
  )
    return err("under_age");
  if (!input.confirmed) return err("age_unconfirmed");
  return ok({ minimumAge: input.minimumAge });
}

/** Whether a birth date on file already rules the player out. */
export function underAge(
  minimumAge: number,
  birthDate: string | null,
  today: string,
): boolean {
  return birthDate !== null && !isAtLeast(minimumAge, birthDate, today);
}

/** The box a player ticks: "I'm 21 or older". */
export function ageConfirmationLabel(minimumAge: number): string {
  return `I'm ${minimumAge} or older`;
}

/** What a player is told when they can't go on. */
export function ageMessage(refusal: AgeRefusal, minimumAge: number): string {
  return refusal === "age_unconfirmed"
    ? `Confirm you're ${minimumAge} or older to go on.`
    : `Thanks for wanting to play! Players in this league must be ${minimumAge} or older, so you can't register this season. If your birth date on your profile is wrong, fix it there.`;
}

/**
 * The season form's minimum age: blank means the league's own, otherwise a
 * whole number from 18 to 99.
 */
export function parseMinimumAge(
  raw: string,
): Result<number | null, "minimum_age"> {
  const text = raw.trim();
  if (text === "") return ok(null);
  if (!/^\d{1,2}$/.test(text)) return err("minimum_age");
  const age = Number(text);
  return age < LOWEST_MINIMUM_AGE || age > HIGHEST_MINIMUM_AGE
    ? err("minimum_age")
    : ok(age);
}
