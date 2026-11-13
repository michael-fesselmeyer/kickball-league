/**
 * Plain words for the audit log page. Actions are `area.verb` strings
 * written by `recordAudit`; an action not listed here reads as itself, so
 * a new one never breaks the page.
 */
const ACTIONS: Record<string, string> = {
  "account.delete": "Deleted their account",
  "announcement.send": "Sent an announcement",
  "awards.close": "Closed an awards poll early",
  "awards.open": "Opened an awards poll",
  "awards.remove": "Removed an awards poll",
  "blackout.create": "Added a blackout date",
  "blackout.delete": "Removed a blackout date",
  "bracket.create": "Seeded the playoff bracket",
  "bracket.publish": "Published the playoff bracket",
  "challenge.confirm": "Confirmed the sign-up challenge's winner",
  "challenge.start": "Started a team sign-up challenge",
  "challenge.update": "Changed a team sign-up challenge",
  "credit.goodwill": "Gave a player league credit",
  "credit.rebate": "Issued a rain-out rebate as league credit",
  "event.cancel": "Called off an event",
  "event.create": "Added an event",
  "event.delete": "Deleted an event",
  "event.ticket_check_in": "Checked in a ticket holder",
  "event.ticket_refund": "Refunded an event ticket",
  "event.update": "Changed an event",
  "field.create": "Added a field",
  "deal.confirm": "Confirmed a sponsor's deals are current",
  "deal.create": "Added a sponsor deal",
  "deal.turn_off": "Turned off a sponsor deal",
  "deal.turn_on": "Turned on a sponsor deal",
  "deal.update": "Changed a sponsor deal",
  "friend_league.create": "Added a league to the friends directory",
  "friend_league.logo_remove": "Removed a friend league's logo",
  "friend_league.logo_set": "Changed a friend league's logo",
  "friend_league.remove": "Removed a league from the friends directory",
  "friend_league.update": "Changed a friend league's entry",
  "free_agents.build_team": "Built a team from the free-agent pool",
  "free_agents.place": "Placed a free agent on a team",
  "giveaway.create": "Added a giveaway to an event",
  "giveaway.draw": "Drew a giveaway's winners",
  "giveaway.redraw": "Replaced a giveaway winner",
  "giveaway.update": "Changed a giveaway",
  "guarantee.charge": "Charged a captain's saved card for the team balance",
  "guarantee.remove": "Removed a team's guarantee card",
  "guarantee.save": "Saved a card to guarantee a team's balance",
  "incident.file": "Filed an incident report",
  "incident.note": "Added a note to an incident report",
  "incident.reopen": "Reopened an incident report",
  "incident.resolve": "Resolved an incident report",
  "instagram.connect": "Connected the league's Instagram",
  "instagram.disconnect": "Disconnected the league's Instagram",
  "instagram.post_alt": "Described an Instagram photo",
  "instagram.post_cover": "Changed an Instagram photo's cover setting",
  "instagram.post_event": "Tagged an Instagram photo to an event",
  "instagram.post_feature": "Featured or unfeatured an Instagram photo",
  "instagram.post_hide": "Hid or showed an Instagram photo",
  "instagram.post_team": "Tagged an Instagram photo to a team",
  "instagram.show_newest":
    "Changed whether new Instagram posts show on their own",
  "invite.create": "Created a team invite",
  "keep_off.add": "Added a person to a team's not-on-my-team list",
  "keep_off.export_policy":
    "Changed whether a person's own export lists not-on-my-team entries about them",
  "keep_off.override":
    "Placed a person on a team that has them on its not-on-my-team list",
  "keep_off.remove": "Took a person off a team's not-on-my-team list",
  "league.export": "Downloaded the league's data",
  "merch.export": "Downloaded the merch orders for the printer",
  "merch.item_create": "Added a merch item",
  "merch.item_hide": "Hid a merch item from the shop",
  "merch.item_show": "Put a merch item back in the shop",
  "merch.item_update": "Changed a merch item",
  "merch.order_fulfill": "Marked a merch order fulfilled",
  "merch.order_refund": "Refunded a merch order",
  "merch.photo_add": "Added a merch photo",
  "merch.photo_remove": "Removed a merch photo",
  "operator.feature": "Platform operator switched a feature",
  "operator.role": "Platform operator changed a person's role",
  "operator.site_status": "Platform operator changed the site status",
  "payment.record_offline": "Recorded a payment made outside the app",
  "payments.export": "Downloaded payments",
  "books.expense_add": "Added an expense to the books",
  "books.expense_remove": "Removed an expense from the books",
  "books.export": "Downloaded the books",
  "books.file_add": "Stored a receipt or document",
  "books.insurance_add": "Added an insurance certificate",
  "books.insurance_remove": "Removed an insurance certificate",
  "books.permit_details": "Changed a permit's cost, document or dates",
  "dashboard.export": "Downloaded the owner dashboard numbers",
  "money_summary.publish": "Published a season money summary",
  "money_summary.unpublish": "Took down a season money summary",
  "permit.create": "Added a permit window",
  "permit.delete": "Removed a permit window",
  "permit.update": "Changed a permit window",
  "promo_code.create": "Added a promo code",
  "promo_code.disable": "Turned off a promo code",
  "rainout.declare": "Called a rain-out",
  "referee.assign": "Assigned a ref",
  "referee.unassign": "Removed a ref",
  "refund.issue": "Refunded a payment",
  "roster.export": "Downloaded a roster",
  "schedule.publish": "Published the schedule",
  "schedule.save_version": "Saved a schedule draft",
  "score.override": "Corrected a score",
  "season.assign_waiver": "Chose the season's waiver",
  "season.create": "Created a season",
  "season.update": "Changed season settings",
  "shirts.set_status": "Updated shirt status",
  "slots.sync": "Regenerated game slots",
  "sponsor.add_member": "Gave a person a sponsor's portal",
  "sponsor.create": "Added a sponsor",
  "sponsor.remove": "Removed a sponsor",
  "sponsor.remove_member": "Took a person off a sponsor's portal",
  "sponsor.update": "Changed a sponsor's page",
  "sportsmanship.rate": "Rated a team's sportsmanship",
  "suspension.issue": "Suspended a player",
  "suspension.lift": "Lifted a player's suspension",
  "team.approve_new": "Approved a new team",
  "team.decline_new": "Declined a new team",
  "team.register": "Registered a team",
  "team.request_new": "Asked to start a new team",
  "team.withdraw_request": "Withdrew a request to start a new team",
  "team_of_week.remove": "Removed a team of the week",
  "team_of_week.set": "Named the team of the week",
  "team_request.add": "Added a scheduling request",
  "team_request.remove": "Removed a scheduling request",
  "venue.create": "Added a venue",
  "waiver.publish": "Published a waiver",
};

export function describeAction(action: string): string {
  return ACTIONS[action] ?? action;
}

export const isOperatorAction = (action: string) =>
  action.startsWith("operator.");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const show = (value: unknown): string => {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value))
    return value.length ? value.map(show).join(", ") : "none";
  if (isRecord(value)) return "(details)";
  return String(value);
};

/**
 * For a change whose before and after are flat records, the fields that
 * changed as "field: before → after"; nothing when there is no such
 * comparison to make.
 */
export function describeChange(before: unknown, after: unknown): string[] {
  if (!isRecord(before) || !isRecord(after)) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key}: ${show(before[key])} → ${show(after[key])}`);
}
