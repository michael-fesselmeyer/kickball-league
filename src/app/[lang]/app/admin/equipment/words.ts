import type { KitHistoryLine } from "@/db/queries/equipment";
import { GEAR_ERRORS } from "@/domain/equipment/equipment";

/** Messages for the admin's gear screens, by the `?error=` and `?notice=` codes. */
export const ADMIN_GEAR_ERRORS: Record<string, string> = {
  ...GEAR_ERRORS,
  name_missing: "Give the kit a name.",
  name_too_long: "Keep the name short: 40 characters at most.",
  contents_missing: "List what's in the kit, one item per line.",
  too_many_items: "A kit lists 20 items at most.",
  item_too_long: "Keep each item under 60 characters.",
  home_missing: "Say where the kit lives between game days.",
  home_too_long: "Keep the home location under 120 characters.",
  name_taken: "Another kit already has that name.",
  out: "Get the kit back home before retiring it.",
  game_over: "That game is over or called off.",
  not_candidate:
    "Pick the game's ref, one of its captains or a league admin to bring it.",
  busy_that_day:
    "That kit already goes to another game that day. Take it off that one first.",
  pick_game: "Pick a game first.",
  pick_person: "Pick who brings the kit.",
};

export const ADMIN_GEAR_NOTICES: Record<string, string> = {
  created: "Kit added. It's at its home until someone picks it up.",
  updated: "Kit saved.",
  retired: "Kit retired. Its history stays here.",
  assigned: "Assigned. They'll get a reminder the evening before.",
  unassigned: "Taken off the game.",
  moved: "Saved where the kit is.",
  resolved: "Report marked sorted.",
};

/** One line of a kit's history, in plain words. */
export function historyWords(line: KitHistoryLine): string {
  const from = line.fromName ?? "its home";
  const to = line.toName ?? "its home";
  const by = line.byName ?? "Someone";
  switch (line.kind) {
    case "handoff_pending":
      return `${from} says they handed it to ${to}; waiting for ${to} to confirm`;
    case "handoff_confirmed":
      if (line.fromName === null && line.toName !== null)
        return line.byName === line.toName
          ? `${to} picked it up from its home`
          : `${by} noted it's with ${to}`;
      if (line.toName === null)
        return line.byName === line.fromName
          ? `${from} returned it home`
          : `${by} noted it's back home`;
      return line.byName === line.fromName
        ? `${from} handed it to ${to}, who confirmed`
        : `${by} noted it went from ${from} to ${to}`;
    case "handoff_declined":
      return `${to} said ${from} didn't hand it over`;
    case "handoff_cancelled":
      return `A handoff from ${from} to ${to} was taken back`;
    case "report":
      return `${by} reported missing: ${missingWords(line.missing ?? [], line.note ?? null)}`;
    case "report_resolved":
      return `${by} marked a missing-items report sorted`;
  }
}

/** "Pump, Cones (8). Note: left at the field". */
export function missingWords(missing: readonly string[], note: string | null) {
  const items = missing.length > 0 ? missing.join(", ") : "nothing listed";
  return note ? `${items}. Note: ${note}` : items;
}
