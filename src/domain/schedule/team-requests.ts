import { err, ok, type Result } from "../result";

/**
 * Scheduling requests a captain sends before the schedule is made: a date
 * the team can't play (a conflict, which the scheduler never breaks), or a
 * date or time of day the team would rather have or avoid (a preference,
 * which the scheduler weighs against fairness). They are stored as the
 * scheduler's team constraints.
 */

export type RequestKind = "unavailable" | "prefer" | "avoid";

export type TeamRequest = {
  kind: RequestKind;
  /** `YYYY-MM-DD` in the league's time zone. */
  onDate: string | null;
  /** 0 is the day's earliest game time. */
  timeIndex: number | null;
  reason: string | null;
};

export type RequestError =
  | "bad_kind"
  | "bad_date"
  | "date_outside_season"
  | "bad_time"
  | "needs_date"
  | "needs_date_or_time"
  | "reason_too_long"
  | "too_many";

/** Enough for a season's real conflicts, few enough to keep the scheduler honest. */
export const MAX_REQUESTS_PER_TEAM = 10;
export const MAX_REASON_LENGTH = 200;

const KINDS: readonly RequestKind[] = ["unavailable", "prefer", "avoid"];
const isKind = (value: string): value is RequestKind =>
  (KINDS as readonly string[]).includes(value);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

export type RequestForm = {
  kind: string;
  onDate: string;
  timeIndex: string;
  reason: string;
};

export type SeasonFrame = {
  startsOn: string;
  endsOn: string;
  /** The time indexes the season's slots use. */
  timeIndexes: readonly number[];
};

/**
 * Checks one submitted request against the season. A conflict needs a date
 * (a whole day off, or one time that day); a preference needs a date, a
 * time, or both.
 */
export function parseTeamRequest(
  form: RequestForm,
  season: SeasonFrame,
  existing: number,
): Result<TeamRequest, RequestError> {
  if (existing >= MAX_REQUESTS_PER_TEAM) return err("too_many");
  const kind = form.kind.trim();
  if (!isKind(kind)) return err("bad_kind");

  const dateText = form.onDate.trim();
  let onDate: string | null = null;
  if (dateText !== "") {
    if (!isRealDate(dateText)) return err("bad_date");
    if (dateText < season.startsOn || dateText > season.endsOn)
      return err("date_outside_season");
    onDate = dateText;
  }

  const timeText = form.timeIndex.trim();
  let timeIndex: number | null = null;
  if (timeText !== "") {
    const parsed = Number(timeText);
    if (!Number.isInteger(parsed) || !season.timeIndexes.includes(parsed))
      return err("bad_time");
    timeIndex = parsed;
  }

  if (kind === "unavailable" && onDate === null) return err("needs_date");
  if (onDate === null && timeIndex === null) return err("needs_date_or_time");

  const reasonText = form.reason.trim();
  if (reasonText.length > MAX_REASON_LENGTH) return err("reason_too_long");

  return ok({
    kind,
    onDate,
    timeIndex,
    reason: reasonText === "" ? null : reasonText,
  });
}

/**
 * Captains may send or change requests until registration closes, or until
 * the season starts when no close is set. Admins may change them any time.
 */
export function requestsOpen(
  window: { registrationClosesAt: Date | null; startsOn: string },
  now: Date,
): boolean {
  const closes =
    window.registrationClosesAt ?? new Date(`${window.startsOn}T00:00:00Z`);
  return now.getTime() < closes.getTime();
}

/** One line a captain or admin can read, given how each time index looks. */
export function describeRequest(
  request: Pick<TeamRequest, "kind" | "onDate" | "timeIndex">,
  timeLabel: (timeIndex: number) => string,
  dateLabel: (date: string) => string,
): string {
  const when = [
    request.onDate !== null ? dateLabel(request.onDate) : null,
    request.timeIndex !== null
      ? `the ${timeLabel(request.timeIndex)} game`
      : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  switch (request.kind) {
    case "unavailable":
      return `Can't play: ${when}`;
    case "prefer":
      return `Would rather play: ${when}`;
    case "avoid":
      return `Would rather not play: ${when}`;
  }
}

export const REQUEST_ERRORS: Record<RequestError, string> = {
  bad_kind: "Choose whether this is a conflict or a preference.",
  bad_date: "That date isn't valid.",
  date_outside_season: "Pick a date inside the season.",
  bad_time: "Pick one of the season's game times.",
  needs_date: "A conflict needs the date your team can't play.",
  needs_date_or_time: "Pick a date, a game time, or both.",
  reason_too_long: `Keep the note under ${MAX_REASON_LENGTH} characters.`,
  too_many: `A team can send up to ${MAX_REQUESTS_PER_TEAM} requests. Remove one to add another.`,
};
