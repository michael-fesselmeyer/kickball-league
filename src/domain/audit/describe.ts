/**
 * Plain words for the audit log page. Actions are `area.verb` strings
 * written by `recordAudit`; an action not listed here reads as itself, so
 * a new one never breaks the page.
 */
const ACTIONS: Record<string, string> = {
  "account.delete": "Deleted their account",
  "account.merge": "Merged a duplicate account into this one",
  "announcement.cancel": "Cancelled a scheduled announcement",
  "announcement.edit": "Changed a scheduled announcement",
  "announcement.schedule": "Scheduled an announcement",
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
  "checklist.add": "Added a task to the season checklist",
  "checklist.delete": "Removed a task from the season checklist",
  "checklist.done": "Ticked off a season checklist task",
  "checklist.reopen": "Opened a season checklist task again",
  "checklist.start": "Started the season checklist from the template",
  "checklist.update": "Changed a season checklist task",
  "checklist_template.add": "Added a task to the checklist template",
  "checklist_template.delete": "Removed a task from the checklist template",
  "checklist_template.update": "Changed a checklist template task",
  "captaincy.accept": "Accepted the captaincy of a team",
  "captaincy.add_co_captain": "Made a teammate a co-captain",
  "captaincy.cancel": "Withdrew an offer of a team's captaincy",
  "captaincy.decline": "Declined the captaincy of a team",
  "captaincy.offer": "Offered a teammate the team's captaincy",
  "captaincy.remove_co_captain": "Made a co-captain a player again",
  "credit.goodwill": "Gave a player league credit",
  "credit.rebate": "Issued a rain-out rebate as league credit",
  "emergency_contact.view": "Read a game's emergency contacts",
  "equipment.assign": "Assigned a kit of league gear to a game",
  "equipment.hand_off": "Handed a kit of league gear to someone",
  "equipment.handoff_cancel": "Took back a handoff of league gear",
  "equipment.handoff_confirm": "Confirmed they have a kit of league gear",
  "equipment.handoff_decline": "Said they weren't handed a kit of league gear",
  "equipment.kit_create": "Added a kit of league gear",
  "equipment.kit_retire": "Retired a kit of league gear",
  "equipment.kit_update": "Changed a kit of league gear",
  "equipment.pick_up": "Picked up a kit of league gear from its home",
  "equipment.report_missing": "Reported items missing from a kit",
  "equipment.report_resolve": "Marked a missing-items report sorted",
  "equipment.return_home": "Returned a kit of league gear to its home",
  "equipment.set_holder": "Corrected where a kit of league gear is",
  "equipment.unassign": "Took a kit of league gear off a game",
  "event.cancel": "Called off an event",
  "event.create": "Added an event",
  "private_event.request": "Asked for a private league or tournament",
  "private_event.accept": "Set up a private league or tournament",
  "private_event.decline": "Declined a private league or tournament",
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
  "division.assign_teams": "Put teams in divisions",
  "division.create": "Added a division",
  "division.delete": "Removed a division",
  "division.update": "Changed a division",
  "friend_league.create": "Added a league to the friends directory",
  "friend_league.logo_remove": "Removed a friend league's logo",
  "friend_league.logo_set": "Changed a friend league's logo",
  "friend_league.remove": "Removed a league from the friends directory",
  "friend_league.update": "Changed a friend league's entry",
  "free_agents.build_team": "Built a team from the free-agent pool",
  "free_agents.place": "Placed a free agent on a team",
  "game_day.status": "Set a game day's status",
  "giveaway.create": "Added a giveaway to an event",
  "giveaway.draw": "Drew a giveaway's winners",
  "giveaway.redraw": "Replaced a giveaway winner",
  "giveaway.update": "Changed a giveaway",
  "guarantee.charge": "Charged a captain's saved card for the team balance",
  "guarantee.remove": "Removed a team's guarantee card",
  "guarantee.save": "Saved a card to guarantee a team's balance",
  "concern.send": "Sent a concern to the league",
  "concern.read": "Read a sender's email address on a concern",
  "concern.reply": "Replied to a concern",
  "concern.note": "Added a note to a concern",
  "concern.close": "Closed a concern",
  "concern.reopen": "Reopened a concern",
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
  "pickem.own_games":
    "Changed whether players may pick their own team's games in pick'em",
  "member_photo.approve": "Approved a member's photo",
  "member_photo.delete": "Deleted a member's photo",
  "member_photo.reject": "Rejected a member's photo",
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
  "operator.league_create": "Platform operator started a league",
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
  "books.receipt_add": "Added a receipt to an expense",
  "books.no_receipt": "Marked that an expense has no receipt",
  "books.recurring_add": "Set up an expected cost",
  "books.recurring_remove": "Stopped expecting a cost",
  "books.expected_skip": "Skipped an expected cost",
  "books.reimburse": "Marked an owner reimbursed",
  "books.rule_save": "Saved a merchant rule for statement imports",
  "books.rule_remove": "Removed a merchant rule",
  "books.import": "Imported expenses from a statement",
  "dashboard.export": "Downloaded the owner dashboard numbers",
  "report_card.export": "Downloaded a season report card",
  "money_summary.publish": "Published a season money summary",
  "money_summary.unpublish": "Took down a season money summary",
  "permit.create": "Added a permit window",
  "permit.delete": "Removed a permit window",
  "permit.update": "Changed a permit window",
  "promo_code.create": "Added a promo code",
  "promo_code.disable": "Turned off a promo code",
  "rainout.confirm_policy": "Changed whether admins may confirm rain-outs",
  "rainout.declare": "Confirmed a rain-out",
  "rainout.prepare": "Sent a rain-out to the owners to confirm",
  "referee.assign": "Assigned a ref",
  "referee.pay_rate": "Changed the season's per-game ref fee",
  "referee.payout": "Recorded a payment to a ref",
  "referee.pool_add": "Added someone to the ref pool",
  "referee.pool_remove": "Took someone out of the ref pool",
  "referee.check_in": "Marked a ref as at the field",
  "referee.drop": "Dropped a game they were down to ref",
  "referee.take": "Took a game that needed a ref",
  "referee.unassign": "Removed a ref",
  "refund.issue": "Refunded a payment",
  "roster.export": "Downloaded a roster",
  "rule_set.create": "Added a rule set",
  "schedule.publish": "Published the schedule",
  "schedule.save_version": "Saved a schedule draft",
  "score.override": "Corrected a score",
  "season.assign_waiver": "Chose the season's waiver",
  "season.cards": "Built the season's end-of-season player cards",
  "season.rollover": "Started a new season from an earlier one",
  "season.create": "Created a season",
  "season.division_settings": "Changed crossover games and the playoff format",
  "rules.publish": "Published a change to the league's rules",
  "season.update": "Changed season settings",
  "shirts.export": "Downloaded the shirt order for the vendor",
  "shirts.order_place": "Marked the season's shirt order placed",
  "shirts.order_receive": "Marked the season's shirt order received",
  "shirts.order_update": "Changed the shirt order's cost or vendor",
  "shirts.remind": "Reminded players to pick a shirt size",
  "shirts.set_status": "Updated shirt status",
  "shirts.sizes": "Changed the shirt sizes offered",
  "slots.sync": "Regenerated game slots",
  "sponsor.add_member": "Gave a person a sponsor's portal",
  "sponsor.create": "Added a sponsor",
  "sponsor.remove": "Removed a sponsor",
  "sponsor.remove_member": "Took a person off a sponsor's portal",
  "sponsor.update": "Changed a sponsor's page",
  "sportsmanship.rate": "Rated a team's sportsmanship",
  "stat_awards.compute": "Worked out a season's stat awards",
  "stat_awards.note": "Wrote a note on a stat award",
  "stat_awards.publish": "Published a season's stat awards",
  "stat_awards.unpublish": "Took down a season's stat awards",
  "suspension.issue": "Suspended a player",
  "suspension.lift": "Lifted a player's suspension",
  "survey.close": "Closed a season survey",
  "survey.open": "Opened a season survey",
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
  "volunteer.create": "Posted a volunteer shift",
  "volunteer.delete": "Removed a volunteer shift",
  "volunteer.update": "Changed a volunteer shift",
  "waiver.publish": "Published a waiver",
  "win_back.send": "Emailed past players to come back",
  "win_back.template": "Changed the win-back email",
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An internal id, which tells a reader nothing. */
const isId = (value: unknown) => typeof value === "string" && UUID.test(value);

/** "teamsAffected" → "teams affected". */
const words = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * For a change whose before and after are flat records, the fields that
 * changed in plain words: "field: before → after", or "field: value" for one
 * the change only adds (such as a publish's counts). Fields holding internal
 * ids are left out; the row's action and actor already say what happened.
 * Nothing when there is no such comparison to make.
 */
export function describeChange(before: unknown, after: unknown): string[] {
  if (!isRecord(before) || !isRecord(after)) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .filter((key) => !isId(before[key]) && !isId(after[key]))
    .map((key) =>
      Object.hasOwn(before, key)
        ? `${words(key)}: ${show(before[key])} → ${show(after[key])}`
        : `${words(key)}: ${show(after[key])}`,
    );
}
