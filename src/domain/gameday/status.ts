import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { kickoff } from "@/domain/schedule/format";
import { err, ok, type Result } from "@/domain/result";
import { zonedInstant } from "@/domain/time/zoned";

/**
 * A game day's status (issue #383): On, Watching the weather until a
 * decision time, Delayed (chosen games start later) or Off (chosen games,
 * or all of them). Players see it on the public schedule, the game pages
 * and their home screen; Delayed and Off tell the players of the games
 * they touch. Pure functions, so the rules are tested without a database.
 */

export const GAME_DAY_STATES = ["on", "watching", "delayed", "off"] as const;
export type GameDayState = (typeof GAME_DAY_STATES)[number];

export const REASON_MAX = 120;

const isState = (value: unknown): value is GameDayState =>
  typeof value === "string" &&
  (GAME_DAY_STATES as readonly string[]).includes(value);

/** One of the day's games as the status screen and the rules see it. */
export type DayGame = {
  id: string;
  startsAt: Date;
  teams: string;
};

/** A saved status: the state, and the games it touches with any new start. */
export type DayStatus = {
  state: GameDayState;
  /** Watching only: when the league will decide. */
  decideBy: Date | null;
  reason: string | null;
  setAt: Date;
  /** Delayed or Off: the games affected; a delayed game's new start. */
  games: ReadonlyMap<string, Date | null>;
};

export type StatusInput = Omit<DayStatus, "setAt">;

export type StatusError =
  | "bad_state"
  | "reason_too_long"
  | "decide_by_missing"
  | "decide_by_past"
  | "decide_by_after_start"
  | "pick_games"
  | "start_missing"
  | "start_not_later"
  | "day_over";

/**
 * Reads the status form for one game day. Times are HH:MM on that day in
 * the league's time zone. A decision time must still be ahead and no later
 * than first pitch; a delayed game's new start must be later than its
 * scheduled one; Delayed and Off need at least one game.
 */
export function parseStatusForm(
  form: FormData,
  ctx: {
    date: string;
    timeZone: string;
    games: readonly DayGame[];
    now: Date;
  },
): Result<StatusInput, StatusError> {
  const state = form.get("state");
  if (!isState(state)) return err("bad_state");
  const lastStart = Math.max(...ctx.games.map((g) => g.startsAt.getTime()));
  if (ctx.games.length === 0 || lastStart < ctx.now.getTime())
    return err("day_over");
  const rawReason = form.get("reason");
  const reason =
    typeof rawReason === "string" && rawReason.trim() !== ""
      ? rawReason.trim().replace(/\s+/g, " ")
      : null;
  if (reason && reason.length > REASON_MAX) return err("reason_too_long");
  const time = (name: string): Date | null => {
    const raw = form.get(name);
    if (typeof raw !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw))
      return null;
    return zonedInstant(ctx.date, raw, ctx.timeZone);
  };
  const base = { state, reason, decideBy: null, games: new Map() } as const;

  if (state === "on") return ok({ ...base, state });

  if (state === "watching") {
    const decideBy = time("decideBy");
    if (!decideBy) return err("decide_by_missing");
    if (decideBy.getTime() <= ctx.now.getTime()) return err("decide_by_past");
    const firstPitch = Math.min(...ctx.games.map((g) => g.startsAt.getTime()));
    if (decideBy.getTime() > firstPitch) return err("decide_by_after_start");
    return ok({ ...base, state, decideBy });
  }

  // Delayed or Off: the games ticked, or every game for "all".
  const all = form.get("all") === "on";
  const picked = ctx.games.filter(
    (g) => all || form.get(`game:${g.id}`) === "on",
  );
  if (picked.length === 0) return err("pick_games");
  const games = new Map<string, Date | null>();
  for (const g of picked) {
    if (state === "off") {
      games.set(g.id, null);
      continue;
    }
    const start = time(`start:${g.id}`);
    if (!start) return err("start_missing");
    if (start.getTime() <= g.startsAt.getTime()) return err("start_not_later");
    games.set(g.id, start);
  }
  return ok({ ...base, state, games });
}

/** What one game shows under the day's status. */
export type GameStatus =
  | { kind: "on" }
  | { kind: "watching"; decideBy: Date }
  | { kind: "delayed"; newStartsAt: Date }
  | { kind: "off" };

export function gameStatus(
  status: Pick<DayStatus, "state" | "decideBy" | "games"> | null,
  gameId: string,
): GameStatus {
  if (!status || status.state === "on") return { kind: "on" };
  if (status.state === "watching")
    return status.decideBy
      ? { kind: "watching", decideBy: status.decideBy }
      : { kind: "on" };
  if (!status.games.has(gameId)) return { kind: "on" };
  if (status.state === "off") return { kind: "off" };
  const start = status.games.get(gameId);
  return start ? { kind: "delayed", newStartsAt: start } : { kind: "on" };
}

/** "Updated 2:10 PM", the status's age, so a saved copy says how old it is. */
export const updatedWords = (
  setAt: Date,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string =>
  fill(messagesFor(locale).gameday.updated, {
    time: kickoff(setAt, timeZone, locale),
  });

/**
 * The line at the top of the schedule and on the home screen for a day:
 * "Watching the weather: we'll decide by 3:00 PM. Field flooded." Null for
 * a plain On with no reason, which needs no banner.
 */
export function dayLine(
  status: Pick<DayStatus, "state" | "decideBy" | "reason" | "games">,
  dayGames: number,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const words = messagesFor(locale).gameday;
  // The reason is the admin's own words, shown as written.
  const why = status.reason ? ` ${status.reason}.` : "";
  const some = status.games.size < dayGames;
  switch (status.state) {
    case "on":
      return status.reason ? `${words.gamesOn}${why}` : null;
    case "watching":
      return status.decideBy
        ? `${fill(words.watchingDay, { time: kickoff(status.decideBy, timeZone, locale) })}${why}`
        : null;
    case "delayed":
      return `${some ? words.someLate : words.allLate}${why}`;
    case "off":
      return `${some ? words.someOff : words.allOff}${why}`;
  }
}

/** The words for one game: "Starts late: 7:30 PM", "Off", … */
export function gameWords(
  s: GameStatus,
  timeZone: string,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const words = messagesFor(locale).gameday;
  switch (s.kind) {
    case "on":
      return null;
    case "watching":
      return fill(words.watchingGame, {
        time: kickoff(s.decideBy, timeZone, locale),
      });
    case "delayed":
      return fill(words.startsLate, {
        time: kickoff(s.newStartsAt, timeZone, locale),
      });
    case "off":
      return words.off;
  }
}

/** A change one game's players hear about. */
export type GameChange =
  | { gameId: string; kind: "delayed"; newStartsAt: Date }
  | { gameId: string; kind: "off" }
  | { gameId: string; kind: "back_on" };

/**
 * Who hears about a change, game by game: a game that is newly delayed or
 * off, or delayed to a different time, and a game that was delayed or off
 * and is back on its schedule. Watching tells nobody here (players who
 * asked for watches are told separately), and saving the same status again
 * tells nobody twice.
 */
export function changesFor(
  before: Pick<DayStatus, "state" | "decideBy" | "games"> | null,
  after: Pick<DayStatus, "state" | "decideBy" | "games">,
  gameIds: readonly string[],
): GameChange[] {
  const changes: GameChange[] = [];
  for (const id of gameIds) {
    const was = gameStatus(before, id);
    const now = gameStatus(after, id);
    if (now.kind === "off" && was.kind !== "off")
      changes.push({ gameId: id, kind: "off" });
    else if (
      now.kind === "delayed" &&
      (was.kind !== "delayed" ||
        was.newStartsAt.getTime() !== now.newStartsAt.getTime())
    )
      changes.push({
        gameId: id,
        kind: "delayed",
        newStartsAt: now.newStartsAt,
      });
    else if (
      (now.kind === "on" || now.kind === "watching") &&
      (was.kind === "off" || was.kind === "delayed")
    )
      changes.push({ gameId: id, kind: "back_on" });
  }
  return changes;
}

/** Whether players who asked for weather watches hear about this save. */
export function watchNews(
  before: Pick<DayStatus, "state" | "decideBy"> | null,
  after: Pick<DayStatus, "state" | "decideBy">,
): boolean {
  return (
    after.state === "watching" &&
    after.decideBy !== null &&
    (before?.state !== "watching" ||
      before.decideBy?.getTime() !== after.decideBy.getTime())
  );
}
