/**
 * Plain words for the audit log page. Actions are `area.verb` strings
 * written by `recordAudit`; an action not listed here reads as itself, so
 * a new one never breaks the page.
 */
const ACTIONS: Record<string, string> = {
  "account.delete": "Deleted their account",
  "announcement.send": "Sent an announcement",
  "blackout.create": "Added a blackout date",
  "blackout.delete": "Removed a blackout date",
  "bracket.create": "Seeded the playoff bracket",
  "bracket.publish": "Published the playoff bracket",
  "field.create": "Added a field",
  "free_agents.build_team": "Built a team from the free-agent pool",
  "free_agents.place": "Placed a free agent on a team",
  "invite.create": "Created a team invite",
  "league.export": "Downloaded the league's data",
  "operator.feature": "Platform operator switched a feature",
  "operator.role": "Platform operator changed a person's role",
  "operator.site_status": "Platform operator changed the site status",
  "payment.record_offline": "Recorded a payment made outside the app",
  "payments.export": "Downloaded payments",
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
  "team.approve_new": "Approved a new team",
  "team.decline_new": "Declined a new team",
  "team.register": "Registered a team",
  "team.request_new": "Asked to start a new team",
  "team.withdraw_request": "Withdrew a request to start a new team",
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
