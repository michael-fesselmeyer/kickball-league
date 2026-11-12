import Link from "next/link";
import { GameCard } from "@/components/game-card";
import { db } from "@/db/client";
import { publishedSchedule } from "@/db/queries/public-schedule";
import type { SeasonId } from "@/domain/ids";
import type { PublicTeam } from "@/domain/schedule/public-game";
import { pickBlurb } from "@/domain/stats/game-of-the-week";
import { movementLabel, movementWords } from "@/domain/stats/power";
import { seasonStats } from "@/domain/stats/season";
import { streakLabel } from "@/domain/stats/streaks";

type Props = {
  season: { id: SeasonId; timeZone: string };
  /** The season's teams, as the standings list them. */
  teams: readonly Pick<PublicTeam, "name" | "slug">[];
};

/**
 * Below the standings: the game of the week, the power rankings and a way
 * to the league records.
 */
export async function StandingsStats({ season, teams }: Props) {
  const schedule = await publishedSchedule(db, season.id);
  const stats = seasonStats(
    schedule,
    teams.map((t) => t.slug),
    season.timeZone,
    new Date(),
  );
  const names = new Map(teams.map((t) => [t.slug, t.name]));
  const pick = stats.pick
    ? schedule.find((g) => g.id === stats.pick?.gameId)
    : undefined;

  return (
    <>
      {pick && stats.pick && (
        <section
          aria-labelledby="game-of-the-week"
          className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <p className="sticker self-start">Game of the week</p>
          <h2 id="game-of-the-week" className="text-h3">
            {pick.teamA.name} vs {pick.teamB.name}
          </h2>
          <p className="text-text-muted">
            {pickBlurb(stats.pick.reason, pick.teamA.name, pick.teamB.name)}
          </p>
          <GameCard game={pick} timeZone={season.timeZone} showDay />
        </section>
      )}

      <section aria-labelledby="power" className="flex flex-col gap-3">
        <h2 id="power" className="text-h2">
          Power rankings
        </h2>
        {stats.power.length === 0 ? (
          <p className="text-text-muted">
            The rankings start after the first game day.
          </p>
        ) : (
          <>
            <p className="text-small text-text-muted">
              Who&apos;s playing best right now: record, the last three games,
              run difference and how tough their opponents are.
            </p>
            <ol className="flex flex-col">
              {stats.power.map((r) => (
                <li
                  key={r.team}
                  className="flex min-h-11 items-center gap-3 border-t border-border py-2"
                >
                  <span className="w-8 shrink-0 font-display text-h3 tabular-nums">
                    {r.rank}
                  </span>
                  <Link
                    href={`/teams/${r.team}`}
                    className="inline-flex min-h-11 min-w-0 flex-1 items-center break-words underline"
                  >
                    {names.get(r.team) ?? r.team}
                  </Link>
                  <span className="hidden text-small text-text-muted tabular-nums sm:inline">
                    {streakLabel(stats.streaks.get(r.team)?.current ?? null)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-small font-bold tabular-nums">
                    <span aria-hidden="true">{movementLabel(r.movement)}</span>
                    <span className="sr-only">{movementWords(r.movement)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <p>
        <Link
          href="/records"
          className="inline-flex min-h-11 items-center text-brand underline"
        >
          League records
        </Link>
      </p>
    </>
  );
}
