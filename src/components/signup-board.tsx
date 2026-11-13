import type { TeamProgress } from "@/domain/drive/challenge";

export type BoardRow = {
  teamSeasonId: string;
  name: string;
  color: string | null;
  progress: TeamProgress;
  rank?: number;
};

/**
 * Teams by sign-up progress: name, "9 of 12 signed up" and a bar. Team
 * names and counts only, never a player, so every signed-in player can see
 * it. `nudge` adds how many players each team still needs, for admins.
 */
export function SignupBoard({
  rows,
  caption,
  nudge = false,
  highlight,
}: {
  rows: readonly BoardRow[];
  caption: string;
  nudge?: boolean;
  /** The viewer's own team, marked in the list. */
  highlight?: string | undefined;
}) {
  if (rows.length === 0)
    return <p className="text-text-muted">No teams in this season yet.</p>;
  return (
    <ol aria-label={caption} className="flex flex-col gap-2">
      {rows.map((t) => {
        const left = t.progress.of - t.progress.signedUp;
        const mine = t.teamSeasonId === highlight;
        return (
          <li
            key={t.teamSeasonId}
            className={`flex flex-col gap-1 rounded-card border p-3 ${
              mine ? "border-2 border-brand" : "border-border"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="flex items-center gap-2 font-bold">
                {t.rank !== undefined && (
                  <span className="text-text-muted tabular-nums">
                    {t.rank}.
                  </span>
                )}
                {t.color && (
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full border border-border"
                    style={{ background: t.color }}
                  />
                )}
                {t.name}
                {mine && <span className="sr-only"> (your team)</span>}
              </span>
              <span className="tabular-nums">
                {t.progress.signedUp} of {t.progress.of} signed up ·{" "}
                <strong>{t.progress.percent}%</strong>
              </span>
            </div>
            <div
              aria-hidden="true"
              className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className={`h-full rounded-full ${
                  t.progress.percent === 100 ? "bg-success" : "bg-brand"
                }`}
                style={{ width: `${t.progress.percent}%` }}
              />
            </div>
            {nudge && left > 0 && (
              <p className="text-small text-text-muted">
                Needs {left} more {left === 1 ? "player" : "players"} with an
                account and a signed waiver.
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
