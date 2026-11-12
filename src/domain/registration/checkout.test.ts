import { describe, expect, it } from "vitest";
import { type CheckoutRegistration, checkoutItems } from "./checkout";
import type { PricedSeason } from "./pricing";

const season: PricedSeason & { name: string } = {
  name: "Spring 2027",
  status: "registration_open",
  feeModel: "per_team",
  teamFeeCents: 120_000,
  playerFeeCents: null,
  freeAgentFeeCents: 9000,
  earlyBirdEndsAt: null,
  earlyBirdDiscountCents: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
};
const now = new Date("2027-02-15T12:00:00Z");
const team = (
  change: Partial<NonNullable<CheckoutRegistration["team"]>> = {},
) => ({
  teamSeasonId: "ts1",
  teamName: "Kick Bottom",
  role: "player" as const,
  paymentMode: "split" as const,
  shareCents: 8600,
  targetRosterSize: 14,
  ...change,
});
const reg = (
  change: Partial<CheckoutRegistration> = {},
): CheckoutRegistration => ({
  id: "r1",
  kind: "team_member",
  status: "pending_payment",
  team: team(),
  ...change,
});

describe("checkoutItems", () => {
  it("charges a teammate their fixed share", () => {
    expect(checkoutItems(season, reg(), now)).toEqual({
      ok: true,
      items: [
        {
          kind: "player_share",
          amountCents: 8600,
          description: "Spring 2027: Kick Bottom share",
          registrationId: "r1",
          teamSeasonId: "ts1",
        },
      ],
    });
  });

  it("charges a captain paying in full the whole team fee", () => {
    const result = checkoutItems(
      season,
      reg({
        team: team({ role: "captain", paymentMode: "full", shareCents: null }),
      }),
      now,
    );
    expect(result).toMatchObject({
      ok: true,
      items: [{ kind: "team_fee", amountCents: 120_000 }],
    });
    // Teammates of a captain who pays in full owe nothing themselves.
    expect(
      checkoutItems(
        season,
        reg({ team: team({ paymentMode: "full", shareCents: null }) }),
        now,
      ),
    ).toEqual({ ok: false, error: "captain_pays" });
  });

  it("charges free agents and per-player fees", () => {
    expect(
      checkoutItems(season, reg({ kind: "free_agent", team: null }), now),
    ).toMatchObject({
      ok: true,
      items: [
        { kind: "free_agent_fee", amountCents: 9000, teamSeasonId: null },
      ],
    });
    const perPlayer = {
      ...season,
      feeModel: "per_player" as const,
      teamFeeCents: null,
      playerFeeCents: 8500,
    };
    expect(checkoutItems(perPlayer, reg(), now)).toMatchObject({
      ok: true,
      items: [{ kind: "player_fee", amountCents: 8500 }],
    });
  });

  it("refuses before the waiver, after payment, or without a price", () => {
    expect(
      checkoutItems(season, reg({ status: "pending_waiver" }), now),
    ).toEqual({ ok: false, error: "waiver_first" });
    expect(checkoutItems(season, reg({ status: "active" }), now)).toEqual({
      ok: false,
      error: "already_paid",
    });
    expect(
      checkoutItems(season, reg({ team: team({ shareCents: null }) }), now),
    ).toEqual({ ok: false, error: "no_price" });
    expect(
      checkoutItems(
        { ...season, freeAgentFeeCents: null },
        reg({ kind: "free_agent", team: null }),
        now,
      ),
    ).toEqual({ ok: false, error: "no_price" });
    expect(
      checkoutItems({ ...season, feeModel: "per_player" }, reg(), now),
    ).toEqual({ ok: false, error: "no_price" });
    expect(
      checkoutItems(
        { ...season, teamFeeCents: null },
        reg({
          team: team({
            role: "captain",
            paymentMode: "full",
            targetRosterSize: null,
          }),
        }),
        now,
      ),
    ).toEqual({ ok: false, error: "no_price" });
  });
});
