import { isOneOf, recordOf } from "../guards";

/**
 * The player profile form (product-spec.md, "Accounts and profile"): name,
 * phone, gender, shirt size, birth date with an 18+ check, and an emergency
 * contact. Pure: the caller passes today's date in the league's time zone.
 */

export const GENDERS = [
  "woman",
  "man",
  "nonbinary",
  "self_described",
  "undisclosed",
] as const;
export const LINEUP_GENDERS = ["woman", "man"] as const;
export const SHIRT_SIZES = ["xs", "s", "m", "l", "xl", "xxl"] as const;

export type Gender = (typeof GENDERS)[number];
export type LineupGender = (typeof LINEUP_GENDERS)[number];
export type ShirtSize = (typeof SHIRT_SIZES)[number];

export const MINIMUM_AGE = 18;

export type ProfileSettings = {
  firstName: string;
  lastName: string;
  phoneE164: string;
  gender: Gender;
  lineupGender: LineupGender;
  shirtSize: ShirtSize;
  birthDate: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "gender",
  "lineupGender",
  "shirtSize",
  "birthDate",
  "emergencyContactName",
  "emergencyContactPhone",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileForm = Record<ProfileField, string>;
export type ProfileErrors = Partial<Record<ProfileField, string>>;

/**
 * A phone number in E.164, or null. Ten digits (or eleven starting with 1)
 * are read as a US number; anything else needs a leading + and its country
 * code.
 */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+"))
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`;
  return null;
}

/** "+17185550123" → "(718) 555-0123"; other countries stay in E.164. */
export function formatPhone(e164: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Whether someone born on `birthDate` is at least `years` old on `today`
 * (both YYYY-MM-DD). A February 29 birthday counts on March 1 in other years.
 */
export function isAtLeast(
  years: number,
  birthDate: string,
  today: string,
): boolean {
  const [y = 0, m = 0, d = 0] = birthDate.split("-").map(Number);
  const year = y + years;
  const birthday =
    m === 2 && d === 29 && !isLeap(year)
      ? `${year}-03-01`
      : `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return birthday <= today;
}

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Checks the profile form; every field is needed before registration. */
export function parseProfileForm(
  form: ProfileForm,
  today: string,
): { ok: true; value: ProfileSettings } | { ok: false; errors: ProfileErrors } {
  const f = recordOf(PROFILE_FIELDS, (k) => form[k].trim());
  const errors: ProfileErrors = {};

  for (const key of ["firstName", "lastName"] as const)
    if (f[key] === "" || f[key].length > 60)
      errors[key] = "Enter up to 60 characters.";

  const phone = normalizePhone(f.phone);
  if (!phone) errors.phone = "Enter a phone number, such as (718) 555-0123.";

  const gender = isOneOf(GENDERS, f.gender) ? f.gender : null;
  if (!gender) errors.gender = "Choose an option.";
  // The fielding rule counts two groups; a player outside them picks one.
  const chosen =
    gender === "woman" || gender === "man" ? gender : f.lineupGender;
  const lineup = isOneOf(LINEUP_GENDERS, chosen) ? chosen : null;
  if (gender && !lineup)
    errors.lineupGender = "Choose which group the fielding rule counts you in.";

  const shirtSize = isOneOf(SHIRT_SIZES, f.shirtSize) ? f.shirtSize : null;
  if (!shirtSize) errors.shirtSize = "Choose a shirt size.";

  if (!validDate(f.birthDate) || f.birthDate > today)
    errors.birthDate = "Enter your birth date.";
  else if (!isAtLeast(MINIMUM_AGE, f.birthDate, today))
    errors.birthDate = `Players must be ${MINIMUM_AGE} or older.`;

  if (f.emergencyContactName === "" || f.emergencyContactName.length > 120)
    errors.emergencyContactName = "Enter who we should call.";
  const emergency = normalizePhone(f.emergencyContactPhone);
  if (!emergency)
    errors.emergencyContactPhone =
      "Enter a phone number, such as (718) 555-0123.";
  else if (emergency === phone)
    errors.emergencyContactPhone =
      "Use someone else's number, so we can reach them if you are hurt.";

  // Every null below has an error above; the checks narrow the types.
  if (
    Object.keys(errors).length > 0 ||
    !phone ||
    !gender ||
    !lineup ||
    !shirtSize ||
    !emergency
  )
    return { ok: false, errors };
  return {
    ok: true,
    value: {
      firstName: f.firstName,
      lastName: f.lastName,
      phoneE164: phone,
      gender,
      lineupGender: lineup,
      shirtSize,
      birthDate: f.birthDate,
      emergencyContactName: f.emergencyContactName,
      emergencyContactPhone: emergency,
    },
  };
}

/** Stored profile columns back into form values; nulls become blanks. */
export function toProfileForm(p: {
  [K in keyof ProfileSettings]: ProfileSettings[K] | null;
}): ProfileForm {
  return {
    firstName: p.firstName ?? "",
    lastName: p.lastName ?? "",
    phone: p.phoneE164 ? formatPhone(p.phoneE164) : "",
    gender: p.gender ?? "",
    lineupGender: p.lineupGender ?? "",
    shirtSize: p.shirtSize ?? "",
    birthDate: p.birthDate ?? "",
    emergencyContactName: p.emergencyContactName ?? "",
    emergencyContactPhone: p.emergencyContactPhone
      ? formatPhone(p.emergencyContactPhone)
      : "",
  };
}
