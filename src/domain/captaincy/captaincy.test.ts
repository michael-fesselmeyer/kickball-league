import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import {
  checkAccept,
  checkOffer,
  checkRoleChange,
  rolesAfterHandoff,
  type RosterRole,
} from "./captaincy";

const captain = { userId: "cap", role: "captain" as const };
const teammate = { userId: "mate", role: "player" as const };

describe("offering the captaincy", () => {
  it("goes from the captain to a teammate on the roster", () => {
    expect(
      checkOffer({ captain, to: teammate, teamFeeCheckoutOpen: false }),
    ).toEqual(ok({ fromUserId: "cap", toUserId: "mate" }));
  });

  it("can go to a co-captain", () => {
    expect(
      checkOffer({
        captain,
        to: { userId: "co", role: "co_captain" },
        teamFeeCheckoutOpen: false,
      }).ok,
    ).toBe(true);
  });

  it("needs a teammate who is on the roster and isn't the captain", () => {
    expect(
      checkOffer({ captain, to: null, teamFeeCheckoutOpen: false }),
    ).toEqual(err("not_on_team"));
    expect(
      checkOffer({ captain, to: captain, teamFeeCheckoutOpen: false }),
    ).toEqual(err("already_captain"));
  });

  it("needs a captain to hand over", () => {
    expect(
      checkOffer({ captain: null, to: teammate, teamFeeCheckoutOpen: false }),
    ).toEqual(err("no_captain"));
  });

  it("waits while the team fee is being paid", () => {
    expect(
      checkOffer({ captain, to: teammate, teamFeeCheckoutOpen: true }),
    ).toEqual(err("checkout_open"));
  });
});

describe("accepting the captaincy", () => {
  const offer = {
    status: "pending" as const,
    fromUserId: "cap",
    captain,
    to: teammate,
    teamFeeCheckoutOpen: false,
  };

  it("works while the offer waits and nothing has changed", () => {
    expect(checkAccept(offer)).toEqual(ok(undefined));
  });

  it("works once only", () => {
    for (const status of ["accepted", "declined", "cancelled"] as const)
      expect(checkAccept({ ...offer, status })).toEqual(err("not_pending"));
  });

  it("stops working when the team has another captain by then", () => {
    expect(
      checkAccept({ ...offer, captain: { userId: "x", role: "captain" } }),
    ).toEqual(err("captain_changed"));
    expect(checkAccept({ ...offer, captain: null })).toEqual(
      err("captain_changed"),
    );
  });

  it("stops working when the teammate has left", () => {
    expect(checkAccept({ ...offer, to: null })).toEqual(err("not_on_team"));
  });

  it("waits while the team fee is being paid", () => {
    expect(checkAccept({ ...offer, teamFeeCheckoutOpen: true })).toEqual(
      err("checkout_open"),
    );
  });

  it("keeps the old captain on as a co-captain", () => {
    expect(rolesAfterHandoff).toEqual({
      oldCaptain: "co_captain",
      newCaptain: "captain",
    });
  });
});

describe("co-captains", () => {
  it("makes a player a co-captain and back", () => {
    expect(checkRoleChange(teammate, "co_captain")).toEqual(ok(undefined));
    expect(
      checkRoleChange({ userId: "co", role: "co_captain" }, "player"),
    ).toEqual(ok(undefined));
  });

  it("never changes the captain's role", () => {
    for (const to of ["co_captain", "player"] as const)
      expect(checkRoleChange(captain, to)).toEqual(err("is_captain"));
  });

  it("refuses someone off the roster and a change to the same role", () => {
    expect(checkRoleChange(null, "co_captain")).toEqual(err("not_on_team"));
    expect(checkRoleChange(teammate, "player")).toEqual(err("unchanged"));
  });

  it("only ever leaves the captain untouched, whatever is asked", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RosterRole>("captain", "co_captain", "player"),
        fc.constantFrom("co_captain" as const, "player" as const),
        (role, to) => {
          const result = checkRoleChange({ userId: "u", role }, to);
          if (role === "captain") expect(result.ok).toBe(false);
          else expect(result.ok).toBe(role !== to);
        },
      ),
    );
  });
});
