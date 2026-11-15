import { updatedWords } from "@/domain/gameday/status";

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
}: {
  /** "Tue, Sep 15", or the game's own teams. */
  label?: string;
  line: string;
  setAt: Date;
  timeZone: string;
  tone: "watch" | "change" | "calm";
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
        {updatedWords(setAt, timeZone)}
      </p>
    </div>
  );
}

export const toneOf = (
  state: "on" | "watching" | "delayed" | "off",
): "watch" | "change" | "calm" =>
  state === "watching" ? "watch" : state === "on" ? "calm" : "change";
