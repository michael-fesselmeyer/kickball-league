/**
 * Awards voting (product-spec.md, "Awards voting"): admins open a poll for a
 * game day or the whole season, players on a roster that season vote once,
 * and the totals appear only after the poll closes. Everything here is pure;
 * src/db/queries/awards.ts reads and writes the rows.
 */
import { err, ok, type Result } from "../result";
import { zonedInstant } from "../time/zoned";

export type PollKind = "weekly" | "season";
export type Category =
  | "mvp"
  | "best_play"
  | "best_sport"
  | "newcomer"
  | "team_spirit"
  | "best_dressed";
export type NomineeKind = "player" | "team";

/** Each award: its name, who can win it and a line for the ballot. */
export const CATEGORIES: Record<
  Category,
  { label: string; nominee: NomineeKind; prompt: string }
> = {
  mvp: {
    label: "MVP",
    nominee: "player",
    prompt: "Who carried the day?",
  },
  best_play: {
    label: "Best play",
    nominee: "player",
    prompt: "The catch, kick or slide everyone is still talking about.",
  },
  best_sport: {
    label: "Best sport",
    nominee: "player",
    prompt: "Fair, friendly and fun to play against.",
  },
  newcomer: {
    label: "Best newcomer",
    nominee: "player",
    prompt: "A first-season player who made the league better.",
  },
  team_spirit: {
    label: "Team spirit",
    nominee: "team",
    prompt: "The loudest dugout and the best vibes.",
  },
  best_dressed: {
    label: "Best dressed",
    nominee: "team",
    prompt: "Matching socks, capes, costumes: who showed up in style?",
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
export const isCategory = (value: string): value is Category =>
  Object.hasOwn(CATEGORIES, value);

export type PollTimes = { opensAt: Date; closesAt: Date };
export type PollState = "upcoming" | "open" | "closed";

/** Whether a poll takes votes at `now`. It closes at closes_at exactly. */
export function pollState(poll: PollTimes, now: Date): PollState {
  if (now < poll.opensAt) return "upcoming";
  return now < poll.closesAt ? "open" : "closed";
}

/** A short date such as "Mon, Oct 5" for a YYYY-MM-DD game day. */
export function gameDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** The title a poll gets when the admin does not write one. */
export function defaultTitle(
  kind: PollKind,
  category: Category,
  gameDay: string | null,
  seasonName: string,
): string {
  const award = CATEGORIES[category].label;
  return kind === "weekly" && gameDay
    ? `${award}, ${gameDayLabel(gameDay)}`
    : `${seasonName} ${award}`;
}

export const TITLE_MAX = 80;

export type PollForm = {
  kind: string;
  category: string;
  gameDay: string;
  title: string;
  closesOn: string;
  closesTime: string;
};

export type NewPoll = {
  kind: PollKind;
  category: Category;
  gameDay: string | null;
  title: string;
  opensAt: Date;
  closesAt: Date;
};

export type PollFormError =
  | "bad_kind"
  | "bad_category"
  | "pick_game_day"
  | "unknown_game_day"
  | "bad_close"
  | "close_in_past"
  | "title_too_long";

/**
 * An admin's new-poll form, checked. Weekly polls must name one of the
 * season's game days; voting opens now and closes at a local date and time
 * in the league's zone.
 */
export function parsePollForm(
  form: PollForm,
  context: {
    now: Date;
    timeZone: string;
    seasonName: string;
    gameDays: readonly string[];
  },
): Result<NewPoll, PollFormError> {
  if (form.kind !== "weekly" && form.kind !== "season") return err("bad_kind");
  if (!isCategory(form.category)) return err("bad_category");
  let gameDay: string | null = null;
  if (form.kind === "weekly") {
    if (form.gameDay === "") return err("pick_game_day");
    if (!context.gameDays.includes(form.gameDay))
      return err("unknown_game_day");
    gameDay = form.gameDay;
  }
  let closesAt: Date;
  try {
    closesAt = zonedInstant(form.closesOn, form.closesTime, context.timeZone);
  } catch {
    return err("bad_close");
  }
  if (closesAt <= context.now) return err("close_in_past");
  const title =
    form.title.trim().replace(/\s+/g, " ") ||
    defaultTitle(form.kind, form.category, gameDay, context.seasonName);
  if (title.length > TITLE_MAX) return err("title_too_long");
  return ok({
    kind: form.kind,
    category: form.category,
    gameDay,
    title,
    opensAt: context.now,
    closesAt,
  });
}

/** Someone a ballot lists: a player (with their team) or a team. */
export type Nominee = {
  id: string;
  kind: NomineeKind;
  name: string;
  /** For a player, their team; for a team, itself. */
  teamSeasonId: string;
  teamName: string;
};

export type VoteError =
  | "not_open"
  | "not_on_roster"
  | "not_a_nominee"
  | "self_vote"
  | "own_team"
  | "already_voted";

/**
 * Whether `voter` may cast this vote: the poll is open, they are on a
 * roster that season, and the pick is on the ballot and is not themselves
 * or, for a team award, their own team.
 */
export function checkVote(input: {
  poll: PollTimes & { category: Category };
  now: Date;
  voter: { userId: string; teamSeasonId: string | null };
  nomineeId: string;
  ballot: readonly Nominee[];
}): Result<Nominee, VoteError> {
  const { poll, voter } = input;
  if (pollState(poll, input.now) !== "open") return err("not_open");
  if (voter.teamSeasonId === null) return err("not_on_roster");
  const kind = CATEGORIES[poll.category].nominee;
  const pick = input.ballot.find(
    (n) => n.id === input.nomineeId && n.kind === kind,
  );
  if (!pick) return err("not_a_nominee");
  if (kind === "player" && pick.id === voter.userId) return err("self_vote");
  if (kind === "team" && pick.id === voter.teamSeasonId) return err("own_team");
  return ok(pick);
}

export type TallyRow = { nomineeId: string; votes: number; rank: number };

/**
 * Vote counts per nominee, most first (a nominee listed twice is added
 * up). Ties share a rank and the next rank skips ahead (1, 1, 3), as
 * standings do; tied nominees are listed by id so the order is stable.
 * Winners are everyone ranked first.
 */
export function tally(
  counts: readonly { nomineeId: string; votes: number }[],
): { rows: TallyRow[]; winners: string[]; total: number } {
  const totals = new Map<string, number>();
  for (const c of counts)
    if (c.votes > 0)
      totals.set(c.nomineeId, (totals.get(c.nomineeId) ?? 0) + c.votes);
  const sorted = [...totals.entries()].sort(
    ([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0),
  );
  const rows: TallyRow[] = [];
  sorted.forEach(([nomineeId, votes], i) => {
    const previous = rows[i - 1];
    const rank = previous && previous.votes === votes ? previous.rank : i + 1;
    rows.push({ nomineeId, votes, rank });
  });
  return {
    rows,
    winners: rows.filter((r) => r.rank === 1).map((r) => r.nomineeId),
    total: rows.reduce((sum, r) => sum + r.votes, 0),
  };
}

/** "Robin E. and Alex S. tie" or "Robin E. wins", for the results page. */
export function winnerLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} wins`;
  const last = names.at(-1);
  return `${names.slice(0, -1).join(", ")} and ${last} tie`;
}
