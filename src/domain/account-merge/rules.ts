/**
 * Merging duplicate accounts (ADR 0041): how every column that
 * points at a person moves from the merged-away account to the kept one,
 * and what happens when both accounts have a row the database allows only
 * once. Pure data; src/db/queries/account-merge.ts runs it in one
 * transaction. A unit test reads the schema and fails if a column that
 * references `user.id` is missing here, so a new table cannot be forgotten.
 *
 * Kinds:
 * - `move`: point the merged-away account's rows at the kept account.
 * - `dedupe`: like move, but where both accounts have a row with the same
 *   `by` values, resolve the pair first:
 *   - `drop`: delete the merged-away account's row; the kept one stands.
 *   - `leave`: leave the merged-away account's row where it is, as history.
 *   - `close`: set `close` on the merged-away account's row (it stays, closed).
 * - `special`: handled by name in the query layer (sign-in, profile,
 *   registrations, waivers, referrals and other rows with their own rules).
 * - `skip`: not moved, with the reason.
 */

export type DedupeResolution = "drop" | "leave" | "close";

export type PersonRule =
  | { kind: "move"; label: string }
  | {
      kind: "dedupe";
      label: string;
      /** The other columns of the unique key. */
      by: readonly string[];
      /** Only rows matching this SQL condition take part in the key. */
      where?: string;
      resolve: DedupeResolution;
      /** For `close`: the SQL assignment that closes a row. */
      close?: string;
      /** How a clash reads in the preview. */
      clash: string;
    }
  | { kind: "special"; label: string; handler: SpecialHandler }
  | { kind: "skip"; why: string };

export type SpecialHandler =
  | "sessions"
  | "profile"
  | "registrations"
  | "waiver_signatures"
  | "referred"
  | "referrer"
  | "award_votes"
  | "award_nominee"
  | "one_per_person"
  | "rebate_credit";

/** Who did something: an admin, an uploader, an author. Always moves. */
const actor = (label: string): PersonRule => ({ kind: "move", label });

/** Every `table.column` (SQL names) that references `user.id`. */
export const PERSON_COLUMNS: Readonly<Record<string, PersonRule>> = {
  // Sign-in
  "session.user_id": {
    kind: "special",
    label: "signed-in sessions (ended)",
    handler: "sessions",
  },
  "account.user_id": { kind: "move", label: "sign-in methods" },
  "passkey.user_id": { kind: "move", label: "passkeys" },
  "push_subscription.user_id": { kind: "move", label: "push subscriptions" },

  // The person themselves
  "profile.user_id": {
    kind: "special",
    label: "profile details",
    handler: "profile",
  },
  "profile.created_by": actor("profiles created"),
  "notification_preference.user_id": {
    kind: "dedupe",
    label: "email and push settings",
    by: ["topic", "channel"],
    resolve: "drop",
    clash: "Both chose a setting for the same notice; the kept account's stays",
  },
  "alert_setting.user_id": {
    kind: "special",
    label: "alert settings",
    handler: "one_per_person",
  },
  "calendar_feed.user_id": {
    kind: "special",
    label: "calendar feed",
    handler: "one_per_person",
  },
  "message.user_id": { kind: "move", label: "messages" },
  "offline_receipt.user_id": { kind: "move", label: "offline score receipts" },

  // Seasons, teams and registration
  "registration.user_id": {
    kind: "special",
    label: "registrations",
    handler: "registrations",
  },
  "registration.created_by": actor("registrations created"),
  "waiver_signature.user_id": {
    kind: "special",
    label: "waiver signatures",
    handler: "waiver_signatures",
  },
  "waitlist_entry.user_id": {
    kind: "dedupe",
    label: "waitlist places",
    by: ["season_id"],
    where: "status in ('waiting', 'offered')",
    resolve: "close",
    close: "status = 'left'",
    clash:
      "Both are on the same season's waitlist; the kept account keeps its place",
  },
  "team_formation_request.requested_by": {
    kind: "dedupe",
    label: "new-team requests",
    by: ["season_id"],
    where: "status = 'pending'",
    resolve: "close",
    close: "status = 'withdrawn'",
    clash:
      "Both asked to start a team in the same season; the merged-away request is withdrawn",
  },
  "team_formation_request.decided_by": actor("new-team requests decided"),
  "team_keep_off.user_id": {
    kind: "dedupe",
    label: "keep-off list entries",
    by: ["team_id"],
    resolve: "drop",
    clash: "Both are on the same team's keep-off list once",
  },
  "team_keep_off.added_by": actor("keep-off entries added"),
  "friend_group.created_by": actor("friend groups started"),
  "invite.created_by": actor("invites created"),
  "roster_membership.created_by": actor("roster changes"),
  "team.created_by": actor("teams created"),
  "team_season.created_by": actor("team entries created"),

  // Money
  "purchase.user_id": { kind: "move", label: "purchases and payments" },
  "payment.recorded_by": actor("payments recorded"),
  "refund.issued_by": actor("refunds issued"),
  "credit_entry.user_id": {
    kind: "special",
    label: "league credit",
    handler: "rebate_credit",
  },
  "credit_entry.issued_by": actor("credit given"),
  "season_rebate.issued_by": actor("rebates issued"),
  "saved_payment_method.user_id": { kind: "move", label: "saved cards" },
  "referral.referrer_user_id": {
    kind: "special",
    label: "referrals made",
    handler: "referrer",
  },
  "referral.referred_user_id": {
    kind: "special",
    label: "referral that brought them",
    handler: "referred",
  },
  "referral_code.user_id": {
    kind: "special",
    label: "referral link",
    handler: "one_per_person",
  },
  "promo_code.created_by": actor("promo codes created"),
  "money_summary.published_by": actor("money summaries published"),
  "books_file.created_by": actor("bookkeeping files added"),
  "expense.created_by": actor("expenses recorded"),
  "insurance_certificate.created_by": actor("insurance certificates added"),
  "merch_order.user_id": { kind: "move", label: "merch orders" },
  "merch_order.fulfilled_by": actor("merch orders fulfilled"),
  "merch_item.created_by": actor("merch items created"),

  // Games
  "game_rsvp.user_id": {
    kind: "dedupe",
    label: "game RSVPs",
    by: ["game_id"],
    resolve: "drop",
    clash: "Both answered for the same game; the kept account's answer stays",
  },
  "game_lineup_spot.user_id": {
    kind: "dedupe",
    label: "lineup spots",
    by: ["lineup_id"],
    resolve: "drop",
    clash: "Both are in the same lineup; the kept account's spot stays",
  },
  "game_lineup.created_by": actor("lineups made"),
  "game_lineup.updated_by": actor("lineups changed"),
  "game_period.entered_by": actor("innings entered"),
  "game.created_by": actor("games created"),
  "score_report.reported_by": { kind: "move", label: "scores reported" },
  "score_response.user_id": { kind: "move", label: "score confirmations" },
  "referee_assignment.user_id": { kind: "move", label: "games refereed" },
  "referee_assignment.created_by": actor("ref assignments made"),
  "sub_claim.user_id": {
    kind: "dedupe",
    label: "sub claims",
    by: ["sub_request_id"],
    resolve: "leave",
    clash:
      "Both claimed the same sub request; the merged-away claim stays as history",
  },
  "sub_claim.decided_by": actor("sub claims decided"),
  "sub_request.requested_by": actor("sub requests posted"),

  // Events, awards, sponsors and fun
  "event_rsvp.user_id": {
    kind: "dedupe",
    label: "event RSVPs",
    by: ["event_id"],
    resolve: "drop",
    clash: "Both answered for the same event; the kept account's answer stays",
  },
  "event_ticket.user_id": { kind: "move", label: "event tickets" },
  "event.created_by": actor("events created"),
  "award_vote.voter_id": {
    kind: "special",
    label: "award votes",
    handler: "award_votes",
  },
  "award_vote.nominee_user_id": {
    kind: "special",
    label: "award votes received",
    handler: "award_nominee",
  },
  "award_poll.created_by": actor("award polls opened"),
  "giveaway_entry.user_id": {
    kind: "dedupe",
    label: "giveaway entries",
    by: ["giveaway_id"],
    resolve: "leave",
    clash:
      "Both entered the same giveaway; the merged-away entry stays as history",
  },
  "giveaway.created_by": actor("giveaways created"),
  "giveaway_winner.drawn_by": actor("giveaway winners drawn"),
  "checkin.user_id": {
    kind: "dedupe",
    label: "bar check-ins",
    by: ["sponsor_id", "on_date"],
    resolve: "leave",
    clash:
      "Both checked in at the same bar on the same day; the merged-away check-in stays as history",
  },
  "deal_redemption.user_id": { kind: "move", label: "deals used" },
  "deal.created_by": actor("deals created"),
  "sponsor_member.user_id": {
    kind: "dedupe",
    label: "sponsor memberships",
    by: ["sponsor_id"],
    resolve: "drop",
    clash: "Both manage the same sponsor once",
  },
  "sponsor.created_by": actor("sponsors added"),
  "team_of_week.created_by": actor("teams of the week named"),
  "member_photo.uploader_id": { kind: "move", label: "photos" },
  "member_photo.reviewed_by": actor("photos reviewed"),
  "signup_challenge.created_by": actor("sign-up challenges created"),
  "signup_challenge.confirmed_by": actor("sign-up challenges confirmed"),
  "friend_league.created_by": actor("friend leagues added"),
  "social_account.connected_by": actor("social accounts connected"),
  "announcement.author_id": actor("announcements written"),

  // Conduct
  "incident_person.user_id": {
    kind: "dedupe",
    label: "incidents involving them",
    by: ["incident_id"],
    resolve: "drop",
    clash: "Both are named in the same incident once",
  },
  "incident.reported_by": actor("incidents reported"),
  "incident.resolved_by": actor("incidents resolved"),
  "incident_note.author_id": actor("incident notes"),
  "suspension.user_id": {
    kind: "dedupe",
    label: "suspensions",
    by: ["incident_id"],
    resolve: "drop",
    clash:
      "Both were suspended for the same incident; the kept account's suspension stands",
  },
  "suspension.issued_by": actor("suspensions issued"),
  "suspension.lifted_by": actor("suspensions lifted"),
  "sportsmanship_rating.rated_by": actor("sportsmanship ratings"),

  // League setup
  "league.created_by": actor("leagues created"),
  "season.created_by": actor("seasons created"),
  "division.created_by": actor("divisions created"),
  "rule_set.created_by": actor("rule sets created"),
  "venue.created_by": actor("venues created"),
  "field.created_by": actor("fields created"),
  "slot.created_by": actor("slots created"),
  "permit_window.created_by": actor("permit windows created"),
  "blackout.created_by": actor("blackouts created"),
  "team_constraint.created_by": actor("scheduling requests added"),
  "schedule_version.created_by": actor("schedule versions made"),
  "schedule_version.published_by": actor("schedules published"),
  "bracket.created_by": actor("brackets seeded"),
  "waiver.created_by": actor("waivers written"),
  "audit_log.actor_id": actor("audit log entries"),

  // The merge record itself
  "account_merge.kept_user_id": {
    kind: "skip",
    why: "A merge record names both accounts as they were",
  },
  "account_merge.merged_user_id": {
    kind: "skip",
    why: "A merge record names both accounts as they were",
  },
  "account_merge.merged_by": {
    kind: "move",
    label: "account merges made",
  },
};

export type MergeBlocker =
  | { kind: "same_account" }
  | { kind: "acting_admin" }
  | { kind: "already_merged"; which: "kept" | "merged" }
  | { kind: "higher_role"; role: string }
  | { kind: "both_registered"; season: string }
  | { kind: "both_rebated"; season: string };

/** What an admin reads when a merge cannot go ahead. */
export function describeBlocker(b: MergeBlocker): string {
  switch (b.kind) {
    case "same_account":
      return "Pick two different accounts.";
    case "acting_admin":
      return "You can't merge away the account you're signed in with.";
    case "already_merged":
      return b.which === "kept"
        ? "The account to keep was itself merged into another account. Keep that one instead."
        : "That account was already merged into another account.";
    case "higher_role":
      return `The account to merge away is ${b.role === "owner" ? "an owner" : "an admin"}. Give the kept account that role, or remove it, first.`;
    case "both_registered":
      return `Both accounts registered for ${b.season}, and both registrations have a payment, a team or a referral. Refund or cancel one of them first.`;
    case "both_rebated":
      return `Both accounts got a share of the same ${b.season} rain-out rebate. Merging would count one rebate twice; ask an owner to adjust the credit first.`;
  }
}

/**
 * Of two registrations for the same season, which one survives: one that is
 * "empty" (no payment, team spot or referral) gives way to the other. When
 * both have something, the merge is blocked.
 */
export function registrationToKeep(
  kept: { empty: boolean },
  merged: { empty: boolean },
): "kept" | "merged" | "blocked" {
  if (merged.empty) return "kept";
  if (kept.empty) return "merged";
  return "blocked";
}

/** The earlier of two signatures stays; ties keep the kept account's. */
export function signatureToKeep(
  kept: { signedAt: Date },
  merged: { signedAt: Date },
): "kept" | "merged" {
  return merged.signedAt < kept.signedAt ? "merged" : "kept";
}

const RANK: Record<string, number> = { player: 0, admin: 1, owner: 2 };

/** A merged-away account may not carry a role the kept account lacks. */
export function roleBlocks(keptRole: string, mergedRole: string): boolean {
  return (RANK[mergedRole] ?? 0) > (RANK[keptRole] ?? 0);
}

/** Empty profile fields on the kept account are filled from the other one. */
export function fillProfile<T extends Record<string, unknown>>(
  kept: T,
  merged: Partial<T>,
  fields: readonly (keyof T)[],
): Partial<T> {
  const fill: Partial<T> = {};
  for (const f of fields)
    if (
      (kept[f] === null || kept[f] === undefined) &&
      merged[f] !== null &&
      merged[f] !== undefined
    )
      fill[f] = merged[f];
  return fill;
}

/** The address a merged-away account gets: it cannot receive mail. */
export const mergedEmail = (userId: string) =>
  `merged-${userId}@deleted.invalid`;

export const MERGED_NAME = "Merged account";

/** An email as stored for alias lookups. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
