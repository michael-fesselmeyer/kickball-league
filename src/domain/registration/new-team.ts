import { err, ok, type Result } from "@/domain/result";
import { slugify } from "@/domain/slug";

/**
 * A player's request to start a new team (docs/product-spec.md, section 4,
 * and docs/information-architecture.md, section 2.7): the form's fields,
 * checked before anything is written.
 */

export const NAME_MAX = 40;
export const NOTE_MAX = 500;
export const REASON_MAX = 500;

export type NewTeamRequestInput = {
  name: string;
  expectedSize: number;
  paymentMode: "full" | "split";
  note: string | null;
};

export type NewTeamFormError = "bad_name" | "bad_size" | "note_too_long";

/** Collapses runs of spaces so "Kick  Bottom " and "Kick Bottom" are one name. */
export const tidyName = (name: string) => name.trim().replace(/\s+/g, " ");

export function parseNewTeamRequest(
  fields: {
    name: string;
    expectedSize: string;
    paymentMode: string;
    note: string;
  },
  season: {
    rosterMin: number;
    rosterMax: number;
    feeModel: "per_team" | "per_player";
  },
): Result<NewTeamRequestInput, NewTeamFormError> {
  const name = tidyName(fields.name);
  if (!slugify(name) || name.length > NAME_MAX) return err("bad_name");
  const size = Number(fields.expectedSize);
  if (
    !Number.isInteger(size) ||
    size < season.rosterMin ||
    size > season.rosterMax
  )
    return err("bad_size");
  const note = fields.note.trim();
  if (note.length > NOTE_MAX) return err("note_too_long");
  // Priced per player, everyone pays their own fee: there is nothing to split.
  const paymentMode =
    season.feeModel === "per_player"
      ? "full"
      : fields.paymentMode === "full"
        ? "full"
        : "split";
  return ok({ name, expectedSize: size, paymentMode, note: note || null });
}

/** An admin's optional reason for saying no, trimmed; null when blank. */
export function parseDeclineReason(
  raw: string,
): Result<string | null, "reason_too_long"> {
  const reason = raw.trim();
  if (reason.length > REASON_MAX) return err("reason_too_long");
  return ok(reason || null);
}
