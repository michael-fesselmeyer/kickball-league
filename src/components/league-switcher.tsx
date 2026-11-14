import type { LeagueInfo } from "@/db/queries/leagues";
import { sportLabel } from "@/domain/league/new-league";

/**
 * Which league the app is showing, and a way to switch for anyone who
 * belongs to more than one (ADR 0048). Plain links: switching is a request
 * to /app/league/<slug>, which remembers the choice and comes back to
 * `next`. No script.
 */
export function LeagueSwitcher({
  active,
  leagues,
  next = "/app",
}: {
  active: LeagueInfo;
  leagues: readonly LeagueInfo[];
  next?: string;
}) {
  const others = leagues.filter((l) => l.id !== active.id);
  if (others.length === 0) return null;
  return (
    <nav
      aria-label="Your leagues"
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
    >
      <p>
        Showing <strong>{active.name}</strong>{" "}
        <span className="text-text-muted">({sportLabel(active.sport)})</span>
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {others.map((l) => (
          <li key={l.id}>
            <a
              href={`/app/league/${l.slug}?next=${encodeURIComponent(next)}`}
              className="inline-flex min-h-11 items-center font-semibold text-brand underline"
            >
              Switch to {l.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
