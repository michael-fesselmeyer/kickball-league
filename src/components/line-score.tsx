import {
  lineScore,
  type LiveSnapshot,
  ordinal,
  positionLabel,
  REGULATION_INNINGS,
} from "@/domain/scores/live";

/**
 * A game's runs by inning, the way a scoreboard shows them: the team that
 * kicks first on the top row, one column per inning, then the total. Runs a
 * called game does not count are struck through. No state, so it renders on
 * the server and inside the live island alike.
 */
export function LineScore({
  teamA,
  teamB,
  snapshot,
}: {
  teamA: string;
  teamB: string;
  snapshot: LiveSnapshot;
}) {
  const { kicksFirst, halves } = snapshot;
  // The confirmed score, else the one waiting for confirmation.
  const result = snapshot.result ?? snapshot.pending;
  if (!kicksFirst) return null;
  const line = lineScore(halves, kicksFirst);
  const columns = Math.max(
    REGULATION_INNINGS,
    line.innings.at(-1)?.inning ?? 0,
  );
  const counted = result?.inningsPlayed ?? null;
  const byInning = new Map(line.innings.map((i) => [i.inning, i]));
  const a = { side: "A", name: teamA, total: result?.scoreA ?? line.totalA };
  const b = { side: "B", name: teamB, total: result?.scoreB ?? line.totalB };
  const rows = kicksFirst === "A" ? [a, b] : [b, a];

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-center tabular-nums">
          <caption className="sr-only">Runs by inning</caption>
          <thead className="text-small text-text-muted">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-normal">
                <span className="sr-only">Team</span>
              </th>
              {Array.from({ length: columns }, (_, i) => (
                <th
                  key={i}
                  scope="col"
                  className="min-w-6 px-0.5 py-2 font-normal"
                >
                  {i + 1}
                </th>
              ))}
              <th scope="col" className="min-w-8 px-2 py-2 font-bold">
                <abbr title="Runs" className="no-underline">
                  R
                </abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.side} className="border-t border-border">
                <th
                  scope="row"
                  className="max-w-24 truncate px-2 py-2 text-left font-normal sm:max-w-48"
                >
                  {row.name}
                </th>
                {Array.from({ length: columns }, (_, i) => {
                  const runs =
                    byInning.get(i + 1)?.[row.side === "A" ? "a" : "b"] ?? null;
                  const dropped = counted !== null && i + 1 > counted;
                  return (
                    <td
                      key={i}
                      className={`px-0.5 py-2 ${dropped ? "text-text-muted line-through" : ""}`}
                    >
                      {runs ?? ""}
                    </td>
                  );
                })}
                <td className="px-2 py-2 font-display text-h3">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {counted !== null && line.innings.some((i) => i.inning > counted) && (
        <p className="text-small text-text-muted">
          The game was called, so it stands at the end of the {ordinal(counted)}
          . Runs after that don’t count.
        </p>
      )}
    </div>
  );
}

/** The status line and line score; nothing until the first half is in. */
export function LiveLine({
  teamA,
  teamB,
  snapshot,
}: {
  teamA: string;
  teamB: string;
  snapshot: LiveSnapshot;
}) {
  const { kicksFirst, halves, result, pending, closed, reported } = snapshot;
  if (!kicksFirst || halves.length === 0) return null;
  const line = lineScore(halves, kicksFirst);
  const shown = result ?? pending;
  const scoreA = shown?.scoreA ?? line.totalA;
  const scoreB = shown?.scoreB ?? line.totalB;
  const called = shown?.inningsPlayed
    ? `called after the ${ordinal(shown.inningsPlayed)}`
    : null;
  // A plain final needs no chip: the page's header already says so.
  const status = result
    ? called && `Final, ${called}`
    : closed
      ? null
      : reported
        ? `Game over${called ? `, ${called}` : ""}: waiting for confirmation`
        : line.next
          ? `Live: ${positionLabel(line.next)}`
          : "Live";

  return (
    <section aria-labelledby="line-score" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="line-score" className="text-h3">
          Inning by inning
        </h2>
        {status && (
          <p
            role="status"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-text bg-surface px-3 py-1 text-small font-bold"
          >
            {!result && !reported && (
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full bg-danger motion-safe:animate-pulse"
              />
            )}
            {status}
            <span className="sr-only">
              . {teamA} {scoreA}, {teamB} {scoreB}.
            </span>
          </p>
        )}
      </div>
      <LineScore teamA={teamA} teamB={teamB} snapshot={snapshot} />
    </section>
  );
}
