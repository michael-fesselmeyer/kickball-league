import { isOneOf, recordOf } from "../guards";
import { slugify } from "../slug";
import { localDate } from "../scheduler/slots";
import { zonedInstant } from "../time/zoned";
import {
  HIGHEST_MINIMUM_AGE,
  LOWEST_MINIMUM_AGE,
  parseMinimumAge,
} from "@/domain/registration/age";

/**
 * The season setup form (product-spec.md: "Season setup: price per team or
 * per player, early-bird window, roster limits, deadlines"). Admins enter
 * dollars and local dates; the database stores cents and instants.
 *
 * Deadlines are whole days in the league's time zone: registration opens at
 * the start of its day, and the other deadlines last until 11:59 pm.
 */

export const FEE_MODELS = ["per_team", "per_player"] as const;
export type FeeModel = (typeof FEE_MODELS)[number];

export type SeasonSettings = {
  name: string;
  slug: string;
  startsOn: string;
  endsOn: string;
  feeModel: FeeModel;
  teamFeeCents: number | null;
  playerFeeCents: number | null;
  freeAgentFeeCents: number | null;
  earlyBirdEndsAt: Date | null;
  earlyBirdDiscountCents: number | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  paymentDeadlineAt: Date | null;
  maxTeams: number | null;
  rosterMin: number;
  rosterMax: number;
  gamesPerTeamPerDay: 1 | 2;
  /** The season's own minimum age; null uses the league's (ADR 0041). */
  minimumAge: number | null;
};

/** The form's fields, all strings, as an admin types them. */
export const SEASON_FIELDS = [
  "name",
  "startsOn",
  "endsOn",
  "feeModel",
  "teamFee",
  "playerFee",
  "freeAgentFee",
  "earlyBirdEndsOn",
  "earlyBirdDiscount",
  "registrationOpensOn",
  "registrationClosesOn",
  "paymentDeadlineOn",
  "maxTeams",
  "rosterMin",
  "rosterMax",
  "gamesPerTeamPerDay",
  "minimumAge",
] as const;
export type SeasonField = (typeof SEASON_FIELDS)[number];
export type SeasonForm = Record<SeasonField, string>;
export type SeasonErrors = Partial<Record<SeasonField, string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,5}(\.\d{1,2})?$/;

const validDate = (value: string) =>
  DATE.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** "85" or "85.50" dollars → cents; null when blank; NaN when malformed. */
function cents(value: string): number | null {
  const v = value.trim().replace(/^\$/, "");
  if (v === "") return null;
  if (!MONEY.test(v)) return Number.NaN;
  const [whole = "0", part = ""] = v.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/** A whole number; null when blank; NaN when malformed. */
function whole(value: string): number | null {
  const v = value.trim();
  if (v === "") return null;
  return /^\d{1,4}$/.test(v) ? Number(v) : Number.NaN;
}

/**
 * Checks the form and returns the settings to store, or a message for each
 * field that is wrong. The rules mirror the season table's checks, so the
 * database never has to reject what the form accepted.
 */
export function parseSeasonForm(
  form: SeasonForm,
  timeZone: string,
): { ok: true; value: SeasonSettings } | { ok: false; errors: SeasonErrors } {
  const errors: SeasonErrors = {};
  const f = recordOf(SEASON_FIELDS, (k) => form[k].trim());

  const name = f.name;
  const slug = slugify(name);
  if (!slug || name.length > 80)
    errors.name = "Give the season a name of up to 80 characters.";
  // /app/admin/seasons/new is the create page, so no season can be "new".
  else if (slug === "new") errors.name = "Pick a name other than “New”.";

  for (const key of ["startsOn", "endsOn"] as const)
    if (!validDate(f[key])) errors[key] = "Pick a date.";
  if (!errors.startsOn && !errors.endsOn && f.endsOn < f.startsOn)
    errors.endsOn = "The season must end on or after its first day.";

  const feeModel = isOneOf(FEE_MODELS, f.feeModel) ? f.feeModel : null;
  if (!feeModel) errors.feeModel = "Choose a price per team or per player.";

  const money = {
    teamFee: cents(f.teamFee),
    playerFee: cents(f.playerFee),
    freeAgentFee: cents(f.freeAgentFee),
    earlyBirdDiscount: cents(f.earlyBirdDiscount),
  };
  for (const [key, value] of Object.entries(money))
    if (Number.isNaN(value))
      errors[key as keyof typeof money] = "Enter dollars, such as 85 or 85.50.";
  if (feeModel === "per_team" && money.teamFee === null)
    errors.teamFee = "A price per team needs the team fee.";
  if (feeModel === "per_player" && money.playerFee === null)
    errors.playerFee = "A price per player needs the player fee.";

  const dates = {
    earlyBirdEndsOn: f.earlyBirdEndsOn,
    registrationOpensOn: f.registrationOpensOn,
    registrationClosesOn: f.registrationClosesOn,
    paymentDeadlineOn: f.paymentDeadlineOn,
  };
  for (const [key, value] of Object.entries(dates))
    if (value !== "" && !validDate(value))
      errors[key as keyof typeof dates] = "Pick a date, or leave it empty.";

  const earlyBird = money.earlyBirdDiscount;
  if ((earlyBird === null) !== (f.earlyBirdEndsOn === ""))
    errors.earlyBirdDiscount ??=
      "An early-bird price needs both a discount and an end date.";
  const mainFee = feeModel === "per_team" ? money.teamFee : money.playerFee;
  if (
    earlyBird !== null &&
    !Number.isNaN(earlyBird) &&
    mainFee !== null &&
    earlyBird >= mainFee
  )
    errors.earlyBirdDiscount ??= "The discount must be less than the fee.";

  if (
    f.registrationOpensOn &&
    f.registrationClosesOn &&
    f.registrationClosesOn < f.registrationOpensOn
  )
    errors.registrationClosesOn ??=
      "Registration must close on or after the day it opens.";
  if (
    f.registrationOpensOn &&
    f.paymentDeadlineOn &&
    f.paymentDeadlineOn < f.registrationOpensOn
  )
    errors.paymentDeadlineOn ??=
      "The payment deadline must be on or after registration opens.";

  const maxTeams = whole(f.maxTeams);
  if (maxTeams !== null && !(maxTeams >= 2 && maxTeams <= 64))
    errors.maxTeams = "Between 2 and 64 teams, or leave it empty.";
  const rosterMin = whole(f.rosterMin);
  const rosterMax = whole(f.rosterMax);
  if (rosterMin === null || !(rosterMin >= 1 && rosterMin <= 60))
    errors.rosterMin = "Between 1 and 60 players.";
  if (rosterMax === null || !(rosterMax >= 1 && rosterMax <= 60))
    errors.rosterMax = "Between 1 and 60 players.";
  else if (!errors.rosterMin && rosterMin !== null && rosterMax < rosterMin)
    errors.rosterMax = "At least the minimum roster.";

  if (f.gamesPerTeamPerDay !== "1" && f.gamesPerTeamPerDay !== "2")
    errors.gamesPerTeamPerDay = "One game or a doubleheader.";
  const minimumAge = parseMinimumAge(f.minimumAge);
  if (!minimumAge.ok)
    errors.minimumAge = `From ${LOWEST_MINIMUM_AGE} to ${HIGHEST_MINIMUM_AGE}, or leave it empty for the league's.`;

  // Every null below has an error above; the checks narrow the types.
  if (
    Object.keys(errors).length > 0 ||
    !feeModel ||
    rosterMin === null ||
    rosterMax === null ||
    !minimumAge.ok
  )
    return { ok: false, errors };

  const startOfDay = (d: string) =>
    d ? zonedInstant(d, "00:00", timeZone) : null;
  const endOfDay = (d: string) =>
    d ? new Date(zonedInstant(d, "23:59", timeZone).getTime() + 59_999) : null;
  return {
    ok: true,
    value: {
      name,
      slug,
      startsOn: f.startsOn,
      endsOn: f.endsOn,
      feeModel,
      teamFeeCents: money.teamFee,
      playerFeeCents: money.playerFee,
      freeAgentFeeCents: money.freeAgentFee,
      earlyBirdEndsAt: endOfDay(f.earlyBirdEndsOn),
      earlyBirdDiscountCents: earlyBird,
      registrationOpensAt: startOfDay(f.registrationOpensOn),
      registrationClosesAt: endOfDay(f.registrationClosesOn),
      paymentDeadlineAt: endOfDay(f.paymentDeadlineOn),
      maxTeams,
      rosterMin,
      rosterMax,
      gamesPerTeamPerDay: f.gamesPerTeamPerDay === "2" ? 2 : 1,
      minimumAge: minimumAge.value,
    },
  };
}

const dollars = (c: number | null) =>
  c === null ? "" : c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);

/** Stored settings back into form values, for editing. */
export function toSeasonForm(
  s: Omit<SeasonSettings, "slug">,
  timeZone: string,
): SeasonForm {
  const day = (d: Date | null) => (d ? localDate(d, timeZone) : "");
  return {
    name: s.name,
    startsOn: s.startsOn,
    endsOn: s.endsOn,
    feeModel: s.feeModel,
    teamFee: dollars(s.teamFeeCents),
    playerFee: dollars(s.playerFeeCents),
    freeAgentFee: dollars(s.freeAgentFeeCents),
    earlyBirdEndsOn: day(s.earlyBirdEndsAt),
    earlyBirdDiscount: dollars(s.earlyBirdDiscountCents),
    registrationOpensOn: day(s.registrationOpensAt),
    registrationClosesOn: day(s.registrationClosesAt),
    paymentDeadlineOn: day(s.paymentDeadlineAt),
    maxTeams: s.maxTeams === null ? "" : String(s.maxTeams),
    rosterMin: String(s.rosterMin),
    rosterMax: String(s.rosterMax),
    gamesPerTeamPerDay: String(s.gamesPerTeamPerDay),
    minimumAge: s.minimumAge === null ? "" : String(s.minimumAge),
  };
}

/** A blank form with the league's usual defaults. */
export const EMPTY_SEASON_FORM: SeasonForm = {
  name: "",
  startsOn: "",
  endsOn: "",
  feeModel: "per_player",
  teamFee: "",
  playerFee: "",
  freeAgentFee: "",
  earlyBirdEndsOn: "",
  earlyBirdDiscount: "",
  registrationOpensOn: "",
  registrationClosesOn: "",
  paymentDeadlineOn: "",
  maxTeams: "",
  rosterMin: "12",
  rosterMax: "20",
  gamesPerTeamPerDay: "1",
  minimumAge: "",
};
