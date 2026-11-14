import { err, ok, type Result } from "../result";

/**
 * Private leagues and tournaments (ADR 0049): what an organizer asks for,
 * and what an admin sets when accepting it. Pure: the forms' strings in,
 * checked values out.
 */

export const PRIVATE_EVENT_KINDS = ["tournament", "league"] as const;
export type PrivateEventKind = (typeof PRIVATE_EVENT_KINDS)[number];
export const PAYERS = ["organization", "players"] as const;
export type Payer = (typeof PAYERS)[number];

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 32;
const MAX_ORGANIZATION = 120;
const MAX_DATES = 300;
const MAX_NOTE = 2000;
/** The most an admin can charge in one Checkout: $20,000. */
export const MAX_PRICE_CENTS = 2_000_000;

export type RequestInput = {
  kind: PrivateEventKind;
  organization: string;
  teams: number;
  preferredDates: string;
  note: string | null;
};

export type RequestProblem =
  "bad_kind" | "no_organization" | "bad_teams" | "no_dates" | "too_long";

type Fields = Record<string, string | undefined>;

const clean = (value: string | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const isKind = (v: string): v is PrivateEventKind =>
  (PRIVATE_EVENT_KINDS as readonly string[]).includes(v);

export function parseRequest(
  fields: Fields,
): Result<RequestInput, RequestProblem> {
  const kind = clean(fields.kind);
  if (!isKind(kind)) return err("bad_kind");
  const organization = clean(fields.organization);
  if (!organization) return err("no_organization");
  const teams = Number(clean(fields.teams));
  if (!Number.isInteger(teams) || teams < MIN_TEAMS || teams > MAX_TEAMS)
    return err("bad_teams");
  const preferredDates = clean(fields.preferredDates);
  if (!preferredDates) return err("no_dates");
  // A note keeps its line breaks.
  const note = (fields.note ?? "").trim();
  if (
    organization.length > MAX_ORGANIZATION ||
    preferredDates.length > MAX_DATES ||
    note.length > MAX_NOTE
  )
    return err("too_long");
  return ok({
    kind,
    organization,
    teams,
    preferredDates,
    note: note || null,
  });
}

export type Acceptance = {
  name: string;
  startsOn: string;
  endsOn: string;
  payer: Payer;
  /** What the organization pays for every team, in one Checkout. */
  priceCents: number | null;
  /** What each player pays, when players pay. */
  playerFeeCents: number | null;
  gamesPerTeamPerDay: 1 | 2;
};

export type AcceptProblem =
  "no_name" | "bad_dates" | "bad_payer" | "bad_amount" | "bad_games_per_day";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Dollars as typed ("450", "1,200.50") to cents, or null if not money. */
export function cents(raw: string | undefined): number | null {
  const text = clean(raw).replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Math.round(Number(text) * 100);
  return value <= MAX_PRICE_CENTS ? value : null;
}

export function parseAcceptance(
  fields: Fields,
): Result<Acceptance, AcceptProblem> {
  const name = clean(fields.name);
  if (!name || name.length > 80) return err("no_name");
  const startsOn = clean(fields.startsOn);
  const endsOn = clean(fields.endsOn) || startsOn;
  if (
    !DATE.test(startsOn) ||
    !DATE.test(endsOn) ||
    Number.isNaN(Date.parse(`${startsOn}T12:00:00Z`)) ||
    Number.isNaN(Date.parse(`${endsOn}T12:00:00Z`)) ||
    endsOn < startsOn
  )
    return err("bad_dates");
  const payer = clean(fields.payer);
  if (payer !== "organization" && payer !== "players") return err("bad_payer");
  const amount = cents(fields.amount);
  if (amount === null) return err("bad_amount");
  const perDay = clean(fields.gamesPerTeamPerDay) || "1";
  if (perDay !== "1" && perDay !== "2") return err("bad_games_per_day");
  return ok({
    name,
    startsOn,
    endsOn,
    payer,
    priceCents: payer === "organization" ? amount : null,
    playerFeeCents: payer === "players" ? amount : null,
    gamesPerTeamPerDay: perDay === "2" ? 2 : 1,
  });
}

/** "Acme Corp & Co." on 2027-05-08 → "private-acme-corp-co-2027-05-08". */
export function privateSeasonSlug(organization: string, startsOn: string) {
  const base = organization
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `private-${base || "event"}-${startsOn}`;
}
