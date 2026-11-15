import { connection } from "next/server";
import { gameStatus, gameWords, updatedWords } from "@/domain/gameday/status";
import type { SeasonId } from "@/domain/ids";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { cachedDayStatus } from "@/lib/game-cache";

type DayStatus = NonNullable<Awaited<ReturnType<typeof cachedDayStatus>>>;

/**
 * A game's day status on its public page, read per request from the data
 * cache, which setting a status expires at once (its season's tag). Kept
 * out of the page's static shell, like the forecast, so the first visitor
 * after a change never sees the status before it. Nothing when the day has
 * no status for this game.
 */
export async function GameStatusLine({
  seasonId,
  date,
  gameId,
  timeZone,
}: {
  seasonId: SeasonId;
  date: string;
  gameId: string;
  timeZone: string;
}) {
  await connection();
  const day = await cachedDayStatus(seasonId, date);
  return <GameStatusView day={day} gameId={gameId} timeZone={timeZone} />;
}

/** The status line for one game from its day's status, or nothing. */
export function GameStatusView({
  day,
  gameId,
  timeZone,
}: {
  day: DayStatus | null;
  gameId: string;
  timeZone: string;
}) {
  if (!day) return null;
  const status = gameStatus({ ...day, games: new Map(day.games) }, gameId);
  const words = gameWords(status, timeZone);
  if (!words) return null;
  return (
    <GameDayNotice
      line={`${words}.${day.reason ? ` ${day.reason}.` : ""}`}
      setAt={day.setAt}
      timeZone={timeZone}
      tone={toneOf(status.kind)}
    />
  );
}

/**
 * A game day's status where players look (issue #383): the line itself
 * ("Watching the weather: we'll decide by 3:00 PM.") and when it was set,
 * so a saved copy on a phone with no signal says how old it is.
 */
export function GameDayNotice({
  label,
  line,
  setAt,
  timeZone,
  tone,
  locale = DEFAULT_LOCALE,
}: {
  /** "Tue, Sep 15", or the game's own teams. */
  label?: string;
  line: string;
  setAt: Date;
  timeZone: string;
  tone: "watch" | "change" | "calm";
  /** The page's language (ADR 0065); English unless given. */
  locale?: Locale;
}) {
  const border =
    tone === "change"
      ? "border-danger"
      : tone === "watch"
        ? "border-warning"
        : "border-border";
  return (
    <div
      className={`flex flex-col gap-1 rounded-card border-2 ${border} bg-surface p-3`}
    >
      <p>
        {label && <strong>{label}: </strong>}
        {line}
      </p>
      <p className="text-small text-text-muted">
        {updatedWords(setAt, timeZone, locale)}
      </p>
    </div>
  );
}

export const toneOf = (
  state: "on" | "watching" | "delayed" | "off",
): "watch" | "change" | "calm" =>
  state === "watching" ? "watch" : state === "on" ? "calm" : "change";
