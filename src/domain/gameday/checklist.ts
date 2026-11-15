import {
  type GameChecklistItemId,
  parseId,
  type TeamSeasonId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";

/**
 * The game-day checklist (issue #409): what the league expects every game
 * day before and after play, written by admins for each season; the
 * set-up lead's script for asking park users to move; and the outcomes and
 * field checks the set-up lead, captains and refs record. Pure rules, so
 * they are tested without a database.
 */

export const CHECKLIST_PHASES = ["before", "after"] as const;
export type ChecklistPhase = (typeof CHECKLIST_PHASES)[number];

export const ITEM_MAX = 140;
export const ITEMS_PER_PHASE_MAX = 12;
export const SCRIPT_MAX = 600;
export const NOTE_MAX = 500;

/** What a season's checklist says until its admins write their own. */
export const DEFAULT_ITEMS: Readonly<Record<ChecklistPhase, readonly string[]>> =
  {
    before: [
      "Permit ready on a phone or printed",
      "Field set up inside the permitted area",
      "Park users asked to move only by the set-up lead, and before play",
      "No glass and no speakers",
    ],
    after: ["Trash out", "Everyone off the field by the permit's end"],
  };

export const DEFAULT_MOVE_SCRIPT =
  "Hi! We're the kickball league and we have a permit for this field from [start] to [end]. Would you mind moving over before our games start? Thanks so much, and enjoy the park.";

export const PHASE_LABELS: Readonly<Record<ChecklistPhase, string>> = {
  before: "Before the game",
  after: "After the game",
};

export type ChecklistForm = {
  items: Record<ChecklistPhase, string[]>;
  /** Null keeps the default script. */
  script: string | null;
};

export type ChecklistFormError =
  | "too_many_items"
  | "item_too_long"
  | "no_items"
  | "script_too_long";

/**
 * Reads the admin's checklist form: one item per line for each phase,
 * blank lines dropped, repeated items kept once. The script is optional;
 * an empty one goes back to the default.
 */
export function parseChecklistForm(
  form: FormData,
): Result<ChecklistForm, ChecklistFormError> {
  const items = { before: [] as string[], after: [] as string[] };
  for (const phase of CHECKLIST_PHASES) {
    const raw = form.get(phase);
    const lines = (typeof raw === "string" ? raw : "")
      .split("\n")
      .map((l) => l.trim().replace(/\s+/g, " "))
      .filter((l) => l !== "");
    const unique = [...new Set(lines)];
    if (unique.some((l) => l.length > ITEM_MAX)) return err("item_too_long");
    if (unique.length > ITEMS_PER_PHASE_MAX) return err("too_many_items");
    items[phase] = unique;
  }
  if (items.before.length + items.after.length === 0) return err("no_items");
  const rawScript = form.get("script");
  const script =
    typeof rawScript === "string" && rawScript.trim() !== ""
      ? rawScript.trim()
      : null;
  if (script && script.length > SCRIPT_MAX) return err("script_too_long");
  // The default left as it is stays the default, and follows it if it changes.
  return ok({ items, script: script === DEFAULT_MOVE_SCRIPT ? null : script });
}

export const MOVE_OUTCOMES = ["fine", "refused", "complaint"] as const;
export type MoveOutcome = (typeof MOVE_OUTCOMES)[number];

export const OUTCOME_LABELS: Readonly<Record<MoveOutcome, string>> = {
  fine: "They moved, no problem",
  refused: "They refused",
  complaint: "They complained",
};

/** Whether admins see it on the incidents screen: anything but "fine". */
export const needsAdmins = (outcome: MoveOutcome): boolean =>
  outcome !== "fine";

/** A trimmed note, null when empty, or an error when too long. */
export function parseNote(raw: unknown): Result<string | null, "note_too_long"> {
  const note =
    typeof raw === "string" && raw.trim() !== ""
      ? raw.trim().replace(/\s+/g, " ")
      : null;
  return note && note.length > NOTE_MAX ? err("note_too_long") : ok(note);
}

export type MoveForm = { outcome: MoveOutcome; note: string | null };

/** Reads "asked a group to move": the outcome and an optional note. */
export function parseMoveForm(
  form: FormData,
): Result<MoveForm, "pick_outcome" | "note_too_long"> {
  const outcome = form.get("outcome");
  if (
    typeof outcome !== "string" ||
    !(MOVE_OUTCOMES as readonly string[]).includes(outcome)
  )
    return err("pick_outcome");
  const note = parseNote(form.get("note"));
  if (!note.ok) return note;
  return ok({ outcome: outcome as MoveOutcome, note: note.value });
}

export type FieldCheckForm = {
  status: "ok" | "problem";
  note: string | null;
};

/**
 * Reads a field check: "ok" (set up, or left clean) or a problem, which
 * needs a note saying what it was.
 */
export function parseFieldCheckForm(
  form: FormData,
): Result<FieldCheckForm, "pick_status" | "say_what" | "note_too_long"> {
  const status = form.get("status");
  if (status !== "ok" && status !== "problem") return err("pick_status");
  const note = parseNote(form.get("note"));
  if (!note.ok) return note;
  if (status === "problem" && note.value === null) return err("say_what");
  return ok({ status, note: note.value });
}

/** One field's checks on a game day, as the command center shows them. */
export type FieldDay = {
  setup: { status: "ok" | "problem"; at: Date } | null;
  close: { status: "ok" | "problem"; at: Date } | null;
  lastGameEndsAt: Date;
};

/** "Set up", "Not set up yet", … for the command center's field rows. */
export function fieldDayWords(
  day: FieldDay,
  now: Date,
): { setup: string; close: string } {
  const setup = day.setup
    ? day.setup.status === "ok"
      ? "Set-up confirmed"
      : "Set-up problem noted"
    : "Set-up not confirmed yet";
  const close = day.close
    ? day.close.status === "ok"
      ? "Left clean"
      : "Problem noted after play"
    : now.getTime() >= day.lastGameEndsAt.getTime()
      ? "Not confirmed after the last game"
      : "After the last game";
  return { setup, close };
}

/** What the game-day forms say when they can't save, by error code. */
export const GAME_DAY_MESSAGES: Readonly<Record<string, string>> = {
  pick_status: "Pick whether it went fine or there was a problem.",
  say_what: "Say what the problem was.",
  note_too_long: `Keep the note to ${NOTE_MAX} characters.`,
  pick_outcome: "Pick how it went.",
  not_today: "This opens on game day only.",
  not_photo: "Add a photo (JPEG, PNG or WebP), not a PDF.",
  not_field: "That field isn't on today's schedule.",
  storage_full:
    "The league's file storage is full, so the photo wasn't saved. Save the check without a photo.",
  too_large: "That photo is too big. Try taking it again.",
};

/** One tick as a phone sends it: which team, which item, on or off. */
export type Tick = {
  teamSeasonId: TeamSeasonId;
  itemId: GameChecklistItemId;
  on: boolean;
};

/** Reads a tick from a request body; null unless every part is sound. */
export function parseTick(body: unknown): Tick | null {
  if (typeof body !== "object" || body === null) return null;
  const { teamSeasonId, itemId, on } = body as Record<string, unknown>;
  const team = parseId<TeamSeasonId>(teamSeasonId);
  const item = parseId<GameChecklistItemId>(itemId);
  if (!team || !item || typeof on !== "boolean") return null;
  return { teamSeasonId: team, itemId: item, on };
}
