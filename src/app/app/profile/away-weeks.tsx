import type { AwaySeason } from "@/db/queries/away";
import { saveAwayWeeksAction } from "./actions";

const STATUS: Record<string, { tone: string; text: string; role: string }> = {
  saved: {
    tone: "border-success",
    text: "Away weeks saved. Your captain sees who is available each week.",
    role: "status",
  },
  not_registered: {
    tone: "border-danger",
    text: "You're not registered for that season any more.",
    role: "alert",
  },
  season_over: {
    tone: "border-danger",
    text: "That season is over, so its away weeks are locked.",
    role: "alert",
  },
};

/**
 * The weeks the person will miss, one form per season they're registered
 * for. Weeks already gone are shown but can't be changed.
 */
export function AwayWeeks({
  seasons,
  status,
  timeZone,
}: {
  seasons: AwaySeason[];
  status: string | null;
  timeZone: string;
}) {
  const shown = status ? STATUS[status] : undefined;
  // A season whose weeks are all gone has nothing left to mark.
  const open = seasons.filter((s) => s.weeks.some((w) => !w.past));
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(d);
  return (
    <section
      id="away"
      aria-labelledby="away-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="away-heading" className="text-h2">
        Weeks you&apos;ll miss
      </h2>
      <p className="text-text-muted">
        Tick the weeks you know you can&apos;t play, so your captain can find a
        sub in time. Only you, your captains and the league see them.
      </p>
      {shown && (
        <p role={shown.role} className={`rounded-lg border p-3 ${shown.tone}`}>
          {shown.text}
        </p>
      )}
      {open.length === 0 ? (
        <p className="text-text-muted">
          You&apos;re not registered for a season that&apos;s coming up.
        </p>
      ) : (
        open.map((s) => (
          <form
            key={s.seasonId}
            action={saveAwayWeeksAction.bind(null, s.seasonId)}
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">
                {s.seasonName}
                {s.teamName && (
                  <span className="font-normal text-text-muted">
                    {" "}
                    · {s.teamName}
                  </span>
                )}
              </legend>
              {s.weeks.map((w) => (
                <label
                  key={w.week}
                  className={`flex min-h-11 items-center gap-3 ${w.past ? "text-text-muted" : ""}`}
                >
                  <input
                    type="checkbox"
                    name="week"
                    value={w.week}
                    defaultChecked={w.away}
                    disabled={w.past}
                    className="size-5"
                  />
                  <span className="flex flex-col">
                    <span>
                      Week of {w.label}
                      {w.past && " (gone)"}
                    </span>
                    {w.games.length > 0 && (
                      <span className="text-small text-text-muted">
                        {w.games
                          .map((g) => `${when(g.startsAt)} vs ${g.opponent}`)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="btn self-start btn-secondary">
              Save away weeks for {s.seasonName}
            </button>
          </form>
        ))
      )}
    </section>
  );
}
