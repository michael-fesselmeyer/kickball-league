import { db, txDb } from "@/db/client";
import { OFF_APP_METHODS, recordOffAppPayment } from "@/db/queries/payments";
import { seasonForRegistration } from "@/db/queries/registration";
import { registrationForPayment } from "@/db/queries/registrations-admin";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { isOneOf } from "@/domain/guards";
import { parseId, type RegistrationId } from "@/domain/ids";
import { checkoutItems } from "@/domain/registration/checkout";
import type { SignedInSubject } from "@/lib/auth/permission";

export type RecordPaymentError =
  | "unknown_registration"
  | "not_allowed"
  | "bad_method"
  | "waiver_first"
  | "already_paid"
  | "captain_pays"
  | "no_price";

export const RECORD_PAYMENT_MESSAGES: Record<RecordPaymentError, string> = {
  unknown_registration: "That registration is gone.",
  not_allowed: "Only an admin or the team's captain can record that payment.",
  bad_method: "Choose cash, Venmo or other.",
  waiver_first: "They need to sign the waiver before they count as paid.",
  already_paid: "They have already paid.",
  captain_pays: "Their captain is paying the whole team fee.",
  no_price: "The league has not set a price for this yet.",
};

/**
 * Records a cash, Venmo or other payment made outside the app, for an admin
 * or the player's captain (payment.record_offline). The amount is what the
 * player owes at checkout, so the books match what Stripe would have taken.
 */
export async function recordPaymentFor(
  subject: SignedInSubject,
  slug: string,
  rawRegistrationId: string,
  form: FormData,
): Promise<{ ok: true } | { ok: false; error: RecordPaymentError }> {
  const registrationId = parseId<RegistrationId>(rawRegistrationId);
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  const reg =
    season && registrationId
      ? await registrationForPayment(db, season.id, registrationId)
      : null;
  if (!season || !reg) return { ok: false, error: "unknown_registration" };
  const teamSeasonId = reg.team?.teamSeasonId;
  if (
    !can(subject, "payment.record_offline", {
      ...(teamSeasonId ? { teamSeasonId } : {}),
    })
  )
    return { ok: false, error: "not_allowed" };
  const method = form.get("method");
  if (!isOneOf(OFF_APP_METHODS, method))
    return { ok: false, error: "bad_method" };
  const note = form.get("note");
  const now = new Date();
  const items = checkoutItems(season, reg, now);
  if (!items.ok) return { ok: false, error: items.error };
  await txDb.transaction((tx) =>
    recordOffAppPayment(tx, {
      userId: reg.userId,
      seasonId: season.id,
      registrationId: reg.id,
      items: items.items,
      method,
      note: typeof note === "string" ? note : "",
      actorId: subject.userId,
      now,
    }),
  );
  return { ok: true };
}
