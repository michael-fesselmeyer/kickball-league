import { type PricedSeason, priceFor } from "./pricing";

/**
 * What a registration buys at checkout (docs/data-model.md, section 2.3:
 * purchase_item kinds). Pure: the caller passes the season, the registration
 * and the time, and gets the line items to charge.
 */

export type ItemKind =
  "team_fee" | "player_share" | "player_fee" | "free_agent_fee";

export type CheckoutRegistration = {
  id: string;
  kind: "team_member" | "free_agent";
  status: string;
  team: {
    teamSeasonId: string;
    teamName: string;
    role: "captain" | "co_captain" | "player";
    paymentMode: "full" | "split";
    shareCents: number | null;
    targetRosterSize: number | null;
  } | null;
};

export type CheckoutItem = {
  kind: ItemKind;
  amountCents: number;
  description: string;
  registrationId: string;
  teamSeasonId: string | null;
};

export type CheckoutError =
  "waiver_first" | "already_paid" | "captain_pays" | "no_price";

export function checkoutItems(
  season: PricedSeason & { name: string },
  r: CheckoutRegistration,
  now: Date,
): { ok: true; items: CheckoutItem[] } | { ok: false; error: CheckoutError } {
  if (r.status === "pending_waiver")
    return { ok: false, error: "waiver_first" };
  if (r.status !== "pending_payment")
    return { ok: false, error: "already_paid" };

  const base = {
    registrationId: r.id,
    teamSeasonId: r.team?.teamSeasonId ?? null,
  };
  if (r.kind === "free_agent" || !r.team) {
    const price = priceFor(season, { kind: "free_agent" }, now);
    if (!price.ok) return { ok: false, error: "no_price" };
    return {
      ok: true,
      items: [
        {
          ...base,
          kind: "free_agent_fee",
          amountCents: price.cents,
          description: `${season.name}: free agent`,
        },
      ],
    };
  }

  const team = r.team;
  if (season.feeModel === "per_player") {
    const price = priceFor(season, { kind: "teammate", shareCents: null }, now);
    if (!price.ok) return { ok: false, error: "no_price" };
    return {
      ok: true,
      items: [
        {
          ...base,
          kind: "player_fee",
          amountCents: price.cents,
          description: `${season.name}: ${team.teamName}`,
        },
      ],
    };
  }

  if (team.paymentMode === "full") {
    // The captain pays for everyone; teammates owe nothing themselves.
    if (team.role !== "captain") return { ok: false, error: "captain_pays" };
    const price = priceFor(
      season,
      {
        kind: "captain",
        paymentMode: "full",
        rosterSize: team.targetRosterSize ?? 1,
      },
      now,
    );
    if (!price.ok) return { ok: false, error: "no_price" };
    return {
      ok: true,
      items: [
        {
          ...base,
          kind: "team_fee",
          amountCents: price.cents,
          description: `${season.name}: ${team.teamName} team fee`,
        },
      ],
    };
  }

  if (team.shareCents === null) return { ok: false, error: "no_price" };
  return {
    ok: true,
    items: [
      {
        ...base,
        kind: "player_share",
        amountCents: team.shareCents,
        description: `${season.name}: ${team.teamName} share`,
      },
    ],
  };
}
