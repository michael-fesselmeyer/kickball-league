/**
 * Quick polls for captains (ADR 0063): an admin asks a season's captains
 * one question with two to five options, each team gets one vote, and
 * captains may change it until the poll closes. Everything here is pure;
 * src/db/queries/captain-polls.ts reads and writes the rows. Opening,
 * closing and closing-time rules are the awards poll's.
 */
import { pollState, type PollState, type PollTimes } from "../awards/awards";
import { err, ok, type Result } from "../result";
import { zonedInstant } from "../time/zoned";

export { pollState, type PollState, type PollTimes };

export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 5;
export const TITLE_MAX = 120;
export const DETAIL_MAX = 600;
export const OPTION_MAX = 80;

export type ResultsVisibility = "after_voting" | "at_close";
export const RESULTS_VISIBILITIES: readonly ResultsVisibility[] = [
  "after_voting",
  "at_close",
];

export type Voter = "captains" | "captains_and_co";

export type PollForm = {
  title: string;
  detail: string;
  /** The option boxes as posted, blanks included. */
  options: readonly string[];
  voters: string;
  results: string;
  closesOn: string;
  closesTime: string;
};

export type NewCaptainPoll = {
  title: string;
  detail: string;
  options: string[];
  includeCoCaptains: boolean;
  results: ResultsVisibility;
  opensAt: Date;
  closesAt: Date;
};

export type PollFormError =
  | "need_title"
  | "title_too_long"
  | "detail_too_long"
  | "too_few_options"
  | "too_many_options"
  | "option_too_long"
  | "duplicate_option"
  | "bad_voters"
  | "bad_results"
  | "bad_close"
  | "close_in_past";

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * An admin's new-poll form, checked. Blank option boxes are skipped, so an
 * admin can leave spare boxes empty; the same option twice (ignoring case)
 * is refused. Voting opens now and closes at a local date and time in the
 * league's zone, which has to be in the future.
 */
export function parsePollForm(
  form: PollForm,
  context: { now: Date; timeZone: string },
): Result<NewCaptainPoll, PollFormError> {
  const title = tidy(form.title);
  if (title === "") return err("need_title");
  if (title.length > TITLE_MAX) return err("title_too_long");
  const detail = form.detail.trim();
  if (detail.length > DETAIL_MAX) return err("detail_too_long");
  const options = form.options.map(tidy).filter((o) => o !== "");
  if (options.length < OPTIONS_MIN) return err("too_few_options");
  if (options.length > OPTIONS_MAX) return err("too_many_options");
  if (options.some((o) => o.length > OPTION_MAX)) return err("option_too_long");
  const seen = new Set(options.map((o) => o.toLowerCase()));
  if (seen.size !== options.length) return err("duplicate_option");
  if (form.voters !== "captains" && form.voters !== "captains_and_co")
    return err("bad_voters");
  if (form.results !== "after_voting" && form.results !== "at_close")
    return err("bad_results");
  let closesAt: Date;
  try {
    closesAt = zonedInstant(form.closesOn, form.closesTime, context.timeZone);
  } catch {
    return err("bad_close");
  }
  if (closesAt <= context.now) return err("close_in_past");
  return ok({
    title,
    detail,
    options,
    includeCoCaptains: form.voters === "captains_and_co",
    results: form.results,
    opensAt: context.now,
    closesAt,
  });
}

export type VoterRole = "captain" | "co_captain";

export type VoteError =
  "not_open" | "not_a_voter" | "not_an_option" | "team_not_in_poll";

/**
 * Whether this person may vote for this team: the poll is open, the team is
 * in the poll's season and still playing, they captain it (or co-captain it
 * when the poll includes co-captains), and the option is one of the poll's.
 */
export function checkVote(input: {
  poll: PollTimes & { includeCoCaptains: boolean };
  now: Date;
  /** The voter's active role on the team, or null if they have none. */
  role: VoterRole | null;
  teamInPoll: boolean;
  optionId: string;
  optionIds: readonly string[];
}): Result<void, VoteError> {
  if (pollState(input.poll, input.now) !== "open") return err("not_open");
  if (!input.teamInPoll) return err("team_not_in_poll");
  const allowed =
    input.role === "captain" ||
    (input.role === "co_captain" && input.poll.includeCoCaptains);
  if (!allowed) return err("not_a_voter");
  if (!input.optionIds.includes(input.optionId)) return err("not_an_option");
  return ok(undefined);
}

export type Viewer = "admin" | "captain";

/**
 * Whether totals may be shown: to admins always; to a captain once the poll
 * has closed, or, when the admin chose "after voting", once their team has
 * voted. Before a poll opens nobody has anything to see.
 */
export function canSeeResults(input: {
  viewer: Viewer;
  state: PollState;
  visibility: ResultsVisibility;
  teamVoted: boolean;
}): boolean {
  if (input.state === "upcoming") return input.viewer === "admin";
  if (input.viewer === "admin") return true;
  if (input.state === "closed") return true;
  return input.visibility === "after_voting" && input.teamVoted;
}

export type OptionRow = {
  id: string;
  label: string;
  votes: number;
  /** Ties share a rank and the next skips ahead (1, 1, 3). */
  rank: number;
  /** Whole percent of the teams that voted; 0 when nobody has. */
  percent: number;
};

/**
 * Each option's votes in the order the admin wrote them, with a rank. An
 * option nobody picked still appears, ranked last.
 */
export function optionResults(
  options: readonly { id: string; label: string; position: number }[],
  counts: ReadonlyMap<string, number>,
): { rows: OptionRow[]; winners: string[]; total: number } {
  const ordered = [...options].sort((a, b) => a.position - b.position);
  const votesOf = (id: string) => counts.get(id) ?? 0;
  const total = ordered.reduce((sum, o) => sum + votesOf(o.id), 0);
  const rows = ordered.map((o) => {
    const votes = votesOf(o.id);
    return {
      id: o.id,
      label: o.label,
      votes,
      rank: 1 + ordered.filter((x) => votesOf(x.id) > votes).length,
      percent: total === 0 ? 0 : Math.round((votes / total) * 100),
    };
  });
  return {
    rows,
    winners:
      total === 0 ? [] : rows.filter((r) => r.rank === 1).map((r) => r.id),
    total,
  };
}

/** "Aces", "Aces and Bees", "Aces, Bees and Cats". */
export function teamList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A reminder goes out once the poll closes within this long. */
export const REMIND_WITHIN_MS = 24 * 3_600_000;
