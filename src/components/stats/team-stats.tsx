import Link from "next/link";
import { db } from "@/db/client";
import { publishedGamesForTeam } from "@/db/queries/public-schedule";
import type { TeamId } from "@/domain/ids";
import type { PublicGame } from "@/domain/schedule/public-game";
import { movementWords } from "@/domain/stats/power";
import { rivalriesOf, seriesLine } from "@/domain/stats/rivalry";
import { seasonStats, statGamesFrom, teamsFrom } from "@/domain/stats/season";
import { streakLabel, streakNote } from "@/domain/stats/streaks";

type Props = {
  team: { id: TeamId; slug: string; name: string };
  /** The shown season's published schedule, every team's games. */
  schedule: readonly PublicGame[];
  timeZone: string;
};

const RIVALS_SHOWN = 5;

/** A team's power rank, streaks this season and its all-time rivalries. */
export async function TeamStats({ team, schedule, timeZone }: Props) {
  const everything = await publishedGamesForTeam(db, team.id);
  const stats = seasonStats(
    schedule,
    [...teamsFrom(schedule).keys()],
    timeZone,
    new Date(),
  );
  const rank = stats.power.find((r) => r.team === team.slug);
  const streaks = stats.streaks.get(team.slug);
  const names = teamsFrom(everything);
  const name = (slug: string) => names.get(slug)?.name ?? slug;
  const rivals = rivalriesOf(team.slug, statGamesFrom(everything)).slice(
    0,
    RIVALS_SHOWN,
  );
  const note = streakNote(team.name, streaks?.current ?? null);

  if (!rank && rivals.length === 0) return null;
  return (
    <section aria-labelledby="by-the-numbers" className="flex flex-col gap-3">
      <h2 id="by-the-numbers" className="text-h2">
        By the numbers
      </h2>
      {rank && streaks && (
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="flex flex-col-reverse gap-1 rounded-card border border-border bg-surface p-3">
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              Power rank
            </dt>
            <dd className="font-display text-h2 tabular-nums">
              {rank.rank}
              <span className="sr-only">, {movementWords(rank.movement)}</span>
            </dd>
          </div>
          <div className="flex flex-col-reverse gap-1 rounded-card border border-border bg-surface p-3">
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              Streak
            </dt>
            <dd className="font-display text-h2 tabular-nums">
              {streakLabel(streaks.current) || "–"}
            </dd>
          </div>
          <div className="flex flex-col-reverse gap-1 rounded-card border border-border bg-surface p-3">
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              Best run
            </dt>
            <dd className="font-display text-h2 tabular-nums">
              {streaks.longestWin > 0 ? `W${streaks.longestWin}` : "–"}
            </dd>
          </div>
        </dl>
      )}
      {note && <p className="text-text-muted">{note}</p>}
      {rivals.length > 0 && (
        <>
          <h3 className="text-h3">Rivalries</h3>
          <ul className="flex flex-col">
            {rivals.map((r) => (
              <li
                key={r.y}
                className="flex flex-wrap items-center justify-between gap-x-3 border-t border-border py-2"
              >
                <Link
                  href={`/teams/${r.y}`}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {name(r.y)}
                </Link>
                <span className="text-small text-text-muted">
                  {seriesLine(r, name)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
