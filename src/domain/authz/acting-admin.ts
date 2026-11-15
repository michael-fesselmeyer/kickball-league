/**
 * Acting admin: an owner hands some admin powers to a trusted player for a
 * date range (issue #468). A grant names powers, never "admin": each power
 * lists the matrix actions it opens, and an action that no power lists can
 * never be reached this way. Money, roles, the audit log, exports and the
 * private lists stay with the league's admins and owners. The check runs in
 * `can` (permissions.ts), so every page and action that already asks the
 * matrix honors a grant, and no other code reads one.
 */

/** A named bundle of admin actions an owner may hand over. */
export const ACTING_POWERS = [
  "game_day",
  "scores",
  "rainouts",
  "schedule",
  "teams",
  "messages",
  "discipline",
] as const;

export type ActingPower = (typeof ACTING_POWERS)[number];

export const isActingPower = (value: string): value is ActingPower =>
  (ACTING_POWERS as readonly string[]).includes(value);

export const ACTING_POWER_LABELS: Record<
  ActingPower,
  { label: string; hint: string }
> = {
  game_day: {
    label: "Game day",
    hint: "Set a day's status, check refs in, take attendance, log incidents.",
  },
  scores: {
    label: "Scores",
    hint: "Enter, confirm, live-score and override game scores.",
  },
  rainouts: {
    label: "Rain-outs",
    hint: "Prepare and confirm a rain-out and its makeups.",
  },
  schedule: {
    label: "Schedule",
    hint: "Build, change and publish the schedule.",
  },
  teams: {
    label: "Teams and rosters",
    hint: "Approve new teams, manage rosters and lineups, place free agents, handle sub requests.",
  },
  messages: {
    label: "Announcements",
    hint: "Send announcements to a team or the whole league.",
  },
  discipline: {
    label: "Discipline",
    hint: "Review incident reports and suspend players.",
  },
};

/**
 * The matrix actions each power opens, as the admin rule would. The list is
 * the only way an acting admin reaches an admin action, and a test checks
 * that it covers no money, role, audit or export action.
 */
export const ACTING_POWER_ACTIONS = {
  game_day: [
    "game_day.status",
    "referee.check_in",
    "attendance.take",
    "attendance.view",
    "incident.log",
    "rsvp.view_team",
    "lineup.view_order",
    "opposing_captain.view_contact",
    "sub_request.view_pickups",
  ],
  scores: ["score.enter", "score.confirm", "score.override", "score.live"],
  rainouts: ["rainout.prepare", "rainout.confirm"],
  schedule: ["schedule.manage", "conflicts.submit"],
  teams: [
    "team.approve_new",
    "free_agents.place",
    "roster.manage",
    "roster.view_status",
    "roster.view_contacts",
    "captaincy.manage",
    "lineup.edit",
    "sub_request.post",
    "sub_request.decide",
  ],
  messages: ["announcement.send"],
  discipline: ["incident.review", "player.suspend"],
} as const satisfies Record<ActingPower, readonly string[]>;

/** Whether `powers` open `action`. */
export function actingPowersOpen(
  powers: readonly ActingPower[] | undefined,
  action: string,
): boolean {
  if (!powers || powers.length === 0) return false;
  return powers.some((p) =>
    (ACTING_POWER_ACTIONS[p] as readonly string[]).includes(action),
  );
}

export type ActingGrant = {
  powers: readonly string[];
  startsAt: Date;
  endsAt: Date;
  /** Set when an owner ended the handover early. */
  endedAt: Date | null;
};

/** Whether a grant gives its powers at `now`: started, not ended, not expired. */
export const grantIsActive = (g: ActingGrant, now: Date): boolean =>
  g.startsAt <= now &&
  now < g.endsAt &&
  (g.endedAt === null || now < g.endedAt);

/**
 * The powers a person has at `now` from all their grants. Overlapping
 * handovers add up while each lasts, and each ends on its own date.
 */
export function powersAt(
  grants: readonly ActingGrant[],
  now: Date,
): ActingPower[] {
  const set = new Set<ActingPower>();
  for (const g of grants)
    if (grantIsActive(g, now))
      for (const p of g.powers) if (isActingPower(p)) set.add(p);
  return ACTING_POWERS.filter((p) => set.has(p));
}

export type GrantError = "no_powers" | "bad_dates" | "in_the_past" | "too_long";

/** The longest a handover may run; renew it to go on. */
export const MAX_GRANT_DAYS = 90;

/** Checks a new grant's powers and dates. */
export function checkGrant(
  input: { powers: readonly string[]; startsAt: Date; endsAt: Date },
  now: Date,
): GrantError | null {
  if (!input.powers.some(isActingPower)) return "no_powers";
  if (input.powers.some((p) => !isActingPower(p))) return "no_powers";
  if (
    Number.isNaN(input.startsAt.getTime()) ||
    Number.isNaN(input.endsAt.getTime()) ||
    input.endsAt <= input.startsAt
  )
    return "bad_dates";
  if (input.endsAt <= now) return "in_the_past";
  if (
    input.endsAt.getTime() - input.startsAt.getTime() >
    MAX_GRANT_DAYS * 864e5
  )
    return "too_long";
  return null;
}
