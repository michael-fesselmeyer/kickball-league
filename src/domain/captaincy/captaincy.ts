/**
 * Captain handoff and co-captains (product-spec.md, section 5; ADR 0042).
 * Pure rules; src/db/queries/captaincy.ts reads and writes the rows.
 *
 * - A team has one captain. The captain, or an admin, offers the captaincy
 *   to a teammate on the active roster. The captain keeps the role until
 *   the teammate accepts; then they swap, and the old captain stays on as a
 *   co-captain so nobody loses the team's tools in the middle of a season.
 * - One offer waits at a time; a new offer cancels the last. An offer stops
 *   working once its captain no longer captains or the teammate has left.
 * - On a full-pay team the captain pays the team fee, so the captaincy does
 *   not change hands while a team-fee checkout is open.
 * - The captain, or an admin, makes a teammate a co-captain or a player
 *   again. A co-captain has the captain's team tools but can't change the
 *   captain's role; a co-captain may step down on their own.
 */

import { err, ok, type Result } from "../result";

export type RosterRole = "captain" | "co_captain" | "player";

/** A teammate as the rules see them: their role, if they are on the roster. */
export type Member<Id extends string = string> = {
  userId: Id;
  role: RosterRole;
} | null;

export type OfferError =
  "no_captain" | "not_on_team" | "already_captain" | "checkout_open";

/** Whether the captaincy can be offered to `to` on a team led by `captain`. */
export function checkOffer<Id extends string>(input: {
  captain: Member<Id>;
  to: Member<Id>;
  teamFeeCheckoutOpen: boolean;
}): Result<{ fromUserId: Id; toUserId: Id }, OfferError> {
  const { captain, to } = input;
  if (!captain || captain.role !== "captain") return err("no_captain");
  if (!to) return err("not_on_team");
  if (to.userId === captain.userId || to.role === "captain")
    return err("already_captain");
  if (input.teamFeeCheckoutOpen) return err("checkout_open");
  return ok({ fromUserId: captain.userId, toUserId: to.userId });
}

export type AcceptError =
  "not_pending" | "captain_changed" | "not_on_team" | "checkout_open";

/**
 * Whether the teammate can accept a waiting offer now. The offer is only
 * good while the person who made it still captains and the teammate is
 * still on the roster.
 */
export function checkAccept(input: {
  status: "pending" | "accepted" | "declined" | "cancelled";
  fromUserId: string;
  captain: Member;
  to: Member;
  teamFeeCheckoutOpen: boolean;
}): Result<void, AcceptError> {
  if (input.status !== "pending") return err("not_pending");
  if (input.captain?.userId !== input.fromUserId) return err("captain_changed");
  if (!input.to) return err("not_on_team");
  if (input.teamFeeCheckoutOpen) return err("checkout_open");
  return ok(undefined);
}

/** Roles after an accepted handoff: the old captain stays as co-captain. */
export const rolesAfterHandoff = {
  oldCaptain: "co_captain",
  newCaptain: "captain",
} as const satisfies Record<string, RosterRole>;

export type RoleChangeError = "not_on_team" | "is_captain" | "unchanged";

/** Whether a teammate can become a co-captain, or a player again. */
export function checkRoleChange(
  member: Member,
  to: "co_captain" | "player",
): Result<void, RoleChangeError> {
  if (!member) return err("not_on_team");
  if (member.role === "captain") return err("is_captain");
  if (member.role === to) return err("unchanged");
  return ok(undefined);
}
