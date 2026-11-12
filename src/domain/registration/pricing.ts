/**
 * What a person owes to register, and whether registration is open
 * (product-spec.md: "price per team or per player, early-bird window").
 * Pure: the caller passes the current time.
 */

export type PricedSeason = {
  status: string;
  feeModel: "per_team" | "per_player";
  teamFeeCents: number | null;
  playerFeeCents: number | null;
  freeAgentFeeCents: number | null;
  earlyBirdEndsAt: Date | null;
  earlyBirdDiscountCents: number | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
};

export type Window = "open" | "not_open" | "closed";

/** Registration is open when the season says so and now is inside its dates. */
export function registrationWindow(season: PricedSeason, now: Date): Window {
  if (season.registrationClosesAt && now > season.registrationClosesAt)
    return "closed";
  if (season.registrationOpensAt && now < season.registrationOpensAt)
    return "not_open";
  if (season.status === "registration_open") return "open";
  return season.status === "draft" ? "not_open" : "closed";
}

export type Entry =
  | { kind: "free_agent" }
  | { kind: "captain"; paymentMode: "full" | "split"; rosterSize: number }
  | { kind: "teammate"; shareCents: number | null };

export type Price =
  | {
      ok: true;
      /** What this person pays; 0 when the captain pays for the team. */
      cents: number;
      /** For a captain splitting the fee: each player's fixed share. */
      shareCents: number | null;
      earlyBird: boolean;
    }
  | { ok: false; error: "no_price" };

/**
 * A split team fee, divided by the expected roster and rounded up to whole
 * dollars, so the shares always cover the fee.
 */
export function splitShare(teamFeeCents: number, rosterSize: number): number {
  if (!(rosterSize > 0)) throw new Error("rosterSize must be positive");
  return Math.ceil(teamFeeCents / rosterSize / 100) * 100;
}

export function priceFor(season: PricedSeason, entry: Entry, now: Date): Price {
  const earlyBird =
    season.earlyBirdEndsAt !== null &&
    season.earlyBirdDiscountCents !== null &&
    now <= season.earlyBirdEndsAt;
  const discount = (cents: number) =>
    earlyBird
      ? Math.max(0, cents - (season.earlyBirdDiscountCents ?? 0))
      : cents;

  if (season.feeModel === "per_player") {
    const base =
      entry.kind === "free_agent"
        ? (season.freeAgentFeeCents ?? season.playerFeeCents)
        : season.playerFeeCents;
    if (base === null) return { ok: false, error: "no_price" };
    return { ok: true, cents: discount(base), shareCents: null, earlyBird };
  }

  // Per team: the captain pays it all or splits it into fixed shares.
  if (entry.kind === "free_agent") {
    if (season.freeAgentFeeCents === null)
      return { ok: false, error: "no_price" };
    return {
      ok: true,
      cents: discount(season.freeAgentFeeCents),
      shareCents: null,
      earlyBird,
    };
  }
  if (entry.kind === "teammate")
    return {
      ok: true,
      cents: entry.shareCents ?? 0,
      shareCents: entry.shareCents,
      earlyBird: false,
    };
  if (season.teamFeeCents === null) return { ok: false, error: "no_price" };
  const fee = discount(season.teamFeeCents);
  if (entry.paymentMode === "full")
    return { ok: true, cents: fee, shareCents: null, earlyBird };
  const share = splitShare(fee, entry.rosterSize);
  return { ok: true, cents: share, shareCents: share, earlyBird };
}

/** "$85", "$1,200" or "$85.50". */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return cents % 100 === 0
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}
