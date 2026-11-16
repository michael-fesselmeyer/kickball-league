import { randomBytes } from "node:crypto";
import { err, ok, type Result } from "@/domain/result";
import { MAX_ROSTER, MIN_ROSTER } from "./roster-limits";

export { MAX_ROSTER, MIN_ROSTER };

/**
 * Guest teams and partner tournaments (ADR 0064): the sign-up a guest
 * captain sends, the charity link an admin sets, and when guest data goes.
 * Pure: strings in, checked values out. The app never handles donations, so
 * a charity is a name, a link and a goal to show.
 */

export const MAX_TEAM_NAME = 60;
export const MAX_PERSON_NAME = 80;
export const MIN_SIGNATURE = 3;
export const DEFAULT_GUEST_DATA_DAYS = 30;
export const MIN_GUEST_DATA_DAYS = 1;
export const MAX_GUEST_DATA_DAYS = 90;

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/* ---------- guest sign-up ---------- */

export type GuestSignup = {
  teamName: string;
  captainName: string;
  captainEmail: string;
  rosterSize: number;
};

export type GuestSignupError =
  "team_name" | "captain_name" | "captain_email" | "roster_size";

export const GUEST_SIGNUP_ERRORS: Readonly<Record<GuestSignupError, string>> = {
  team_name: `Give your team a name of up to ${MAX_TEAM_NAME} characters.`,
  captain_name: "Tell us the captain's name.",
  captain_email: "Enter an email address we can reach the captain at.",
  roster_size: `How many players? A whole number from ${MIN_ROSTER} to ${MAX_ROSTER}.`,
};

/** Loose on purpose: the address is only used to reach the captain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseGuestSignup(
  fields: Record<string, string | undefined>,
): Result<GuestSignup, GuestSignupError> {
  const teamName = clean(fields.teamName);
  if (teamName.length === 0 || teamName.length > MAX_TEAM_NAME)
    return err("team_name");
  const captainName = clean(fields.captainName);
  if (captainName.length === 0 || captainName.length > MAX_PERSON_NAME)
    return err("captain_name");
  const captainEmail = clean(fields.captainEmail).toLowerCase();
  if (captainEmail.length > 254 || !EMAIL.test(captainEmail))
    return err("captain_email");
  const raw = clean(fields.rosterSize);
  const rosterSize = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (
    !Number.isInteger(rosterSize) ||
    rosterSize < MIN_ROSTER ||
    rosterSize > MAX_ROSTER
  )
    return err("roster_size");
  return ok({ teamName, captainName, captainEmail, rosterSize });
}

/** A secret for a guest team's waiver link: 24 random bytes, URL-safe. */
export function newLinkToken(): string {
  return randomBytes(24).toString("base64url");
}

export const LINK_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/* ---------- guest waiver ---------- */

export type GuestSignatureError = "name" | "agree";

export function parseGuestSignature(
  fields: Record<string, string | undefined>,
): Result<{ signedName: string }, GuestSignatureError> {
  const signedName = clean(fields.signedName);
  if (signedName.length < MIN_SIGNATURE || signedName.length > MAX_PERSON_NAME)
    return err("name");
  if (fields.agree !== "on") return err("agree");
  return ok({ signedName });
}

/** "3 of 10 players have signed", for the captain and the admin. */
export function signedLine(signed: number, rosterSize: number): string {
  const who = signed === 1 ? "player has" : "players have";
  return `${signed} of ${rosterSize} ${who} signed the waiver.`;
}

/* ---------- settings ---------- */

export type TournamentSettings = {
  guestSignupsOpen: boolean;
  maxGuestTeams: number | null;
  partnerFriendLeagueId: string | null;
  charity: { name: string; url: string; goalCents: number | null } | null;
  guestDataDays: number;
};

export type SettingsError =
  "max_teams" | "charity_name" | "charity_url" | "charity_goal" | "data_days";

export const SETTINGS_ERRORS: Readonly<Record<SettingsError, string>> = {
  max_teams: "The most guest teams is a whole number from 1 to 32, or blank.",
  charity_name: "Name the charity, in up to 80 characters.",
  charity_url:
    "The donation link has to be an https address, up to 300 characters.",
  charity_goal: "The goal is a dollar amount from $1 to $1,000,000, or blank.",
  data_days: `Keep guest details for ${MIN_GUEST_DATA_DAYS} to ${MAX_GUEST_DATA_DAYS} days after the event.`,
};

/** Dollars as typed ("2,500" or "2500.50") to cents, or null if not money. */
export function dollarsToCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function parseSettings(
  fields: Record<string, string | undefined>,
): Result<TournamentSettings, SettingsError> {
  const rawMax = clean(fields.maxGuestTeams);
  let maxGuestTeams: number | null = null;
  if (rawMax !== "") {
    maxGuestTeams = /^\d{1,2}$/.test(rawMax) ? Number(rawMax) : NaN;
    if (!(maxGuestTeams >= 1 && maxGuestTeams <= 32)) return err("max_teams");
  }
  const days = clean(fields.guestDataDays) || String(DEFAULT_GUEST_DATA_DAYS);
  const guestDataDays = /^\d{1,3}$/.test(days) ? Number(days) : NaN;
  if (!(
    guestDataDays >= MIN_GUEST_DATA_DAYS && guestDataDays <= MAX_GUEST_DATA_DAYS
  ))
    return err("data_days");

  const name = clean(fields.charityName);
  const url = clean(fields.charityUrl);
  const goal = clean(fields.charityGoal);
  let charity: TournamentSettings["charity"] = null;
  if (name !== "" || url !== "" || goal !== "") {
    if (name === "" || name.length > 80) return err("charity_name");
    if (!isHttpsUrl(url)) return err("charity_url");
    let goalCents: number | null = null;
    if (goal !== "") {
      goalCents = dollarsToCents(goal);
      if (goalCents === null || goalCents < 100 || goalCents > 100_000_000)
        return err("charity_goal");
    }
    charity = { name, url, goalCents };
  }
  const partner = clean(fields.partnerFriendLeagueId);
  return ok({
    guestSignupsOpen: fields.guestSignupsOpen === "on",
    maxGuestTeams,
    partnerFriendLeagueId: partner === "" ? null : partner,
    charity,
    guestDataDays,
  });
}

/** An https address with a host, as the database check requires. */
export function isHttpsUrl(value: string): boolean {
  if (value.length > 300 || !value.startsWith("https://")) return false;
  try {
    return new URL(value).hostname.includes(".");
  } catch {
    return false;
  }
}

/** "$2,500" or "$12.50". */
export function moneyLine(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/* ---------- sign-up window and retention ---------- */

export type SignupState = "open" | "closed" | "full" | "over" | "cancelled";

/** Whether a guest team can sign up now. */
export function signupState(
  t: {
    guestSignupsOpen: boolean;
    maxGuestTeams: number | null;
    guestTeams: number;
  },
  e: { endsAt: Date; cancelledAt: Date | null },
  now: Date,
): SignupState {
  if (e.cancelledAt) return "cancelled";
  if (e.endsAt <= now) return "over";
  if (!t.guestSignupsOpen) return "closed";
  if (t.maxGuestTeams !== null && t.guestTeams >= t.maxGuestTeams)
    return "full";
  return "open";
}

/** When guest names, emails and signatures are deleted. */
export function guestDataDeleteAt(endsAt: Date, days: number): Date {
  return new Date(endsAt.getTime() + days * 86_400_000);
}

/** Whether the sweep should delete this tournament's guest data now. */
export function guestDataDue(
  t: { guestDataDeletedAt: Date | null; guestDataDays: number },
  e: { endsAt: Date },
  now: Date,
): boolean {
  return (
    t.guestDataDeletedAt === null &&
    guestDataDeleteAt(e.endsAt, t.guestDataDays) <= now
  );
}
