/** Players with their games played and where they stand for the playoffs. */
export function PlayedList({
  title,
  rows,
}: {
  title: string;
  rows: {
    userId: string;
    name: string;
    played: number;
    standing: { eligible: boolean; short: number } | null;
  }[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-h2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-text-muted">No players on this roster.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((p) => (
            <li
              key={p.userId}
              className="flex flex-wrap justify-between gap-2 border-t border-border py-2"
            >
              <span>{p.name}</span>
              <span className="text-text-muted tabular-nums">
                {p.played === 1 ? "1 game" : `${p.played} games`}
                {p.standing &&
                  (p.standing.eligible
                    ? " · playoff eligible"
                    : ` · ${p.standing.short} more for the playoffs`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
