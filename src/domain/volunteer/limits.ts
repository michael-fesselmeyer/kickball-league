/**
 * The volunteer shift's roles and limits, apart from the form parsing in
 * shifts.ts so the admin's form (a client component) ships only these.
 */

export const VOLUNTEER_ROLES = [
  "setup",
  "teardown",
  "check_in",
  "ref_fill_in",
  "setup_lead",
] as const;

export type VolunteerRole = (typeof VOLUNTEER_ROLES)[number];

export const ROLE_LABELS: Readonly<Record<VolunteerRole, string>> = {
  setup: "Setup",
  teardown: "Teardown",
  check_in: "Check-in table",
  ref_fill_in: "Ref fill-in",
  setup_lead: "Set-up lead",
};

export const MAX_SPOTS = 50;
export const MAX_PLACE_LENGTH = 120;
export const MAX_NOTES_LENGTH = 500;
