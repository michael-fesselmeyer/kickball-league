import { LogoBadge } from "@/components/logo-badge";
import type { Hex } from "@/domain/color/contrast";
import {
  attendanceText,
  finishText,
  gameLine,
  recordText,
  type SeasonCardStats,
  sportsmanshipShout,
} from "@/domain/season-card/card";

/**
 * "Your season in kickball" (docs/product-spec.md): the same card on the
 * player's own page and on its public link. Only the player's own numbers,
 * their team and team names of opponents; never another player.
 */

/** "Sun, Jul 12" for a YYYY-MM-DD game day. */
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse items-center gap-1 rounded-card border border-border bg-surface p-3 text-center">
      <dt className="text-small text-text-muted">{label}</dt>
      <dd className="font-display text-h2 leading-none">{value}</dd>
    </div>
  );
}

export function SeasonCardView({
  stats,
  headingId,
}: {
  stats: SeasonCardStats;
  /** The id of the page's h1, which names the card. */
  headingId: string;
}) {
  const finish = finishText(stats.finish);
  const attendance = attendanceText(stats);
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <LogoBadge
          kind="team"
          name={stats.team.name}
          color={stats.team.colorHex as Hex | null}
          size={64}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-text-muted">
            {stats.seasonName} · {stats.team.name}
          </p>
          <h1 id={headingId} className="text-h1">
            {stats.playerName}&apos;s season in kickball
          </h1>
          {stats.finish?.champion && (
            <p className="sticker self-start">Champions</p>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          value={
            stats.attended === null
              ? String(stats.gamesPlayed)
              : `${stats.attended}/${stats.gamesPlayed}`
          }
          label={stats.attended === null ? "games played" : "games made"}
        />
        <Stat value={String(stats.runs)} label="team runs" />
        <Stat
          value={String(stats.longestWinStreak)}
          label="longest win streak"
        />
        <Stat value={recordText(stats.record)} label="team record" />
      </dl>

      <section aria-labelledby="season-story" className="flex flex-col gap-3">
        <h2 id="season-story" className="text-h2">
          The season
        </h2>
        <ul className="flex flex-col gap-2">
          <li>
            {stats.team.name} went {recordText(stats.record)} in the regular
            season
            {finish && !stats.finish?.champion ? `, finishing ${finish}` : ""}
            {stats.finish?.champion ? " and won the title" : ""}.
          </li>
          <li>
            {attendance
              ? `Showed up for ${attendance}, with ${plural(stats.runs, "team run")} in them.`
              : `Played the team's ${plural(stats.gamesPlayed, "game")}, with ${plural(stats.runs, "team run")}.`}
          </li>
          {stats.longestWinStreak >= 2 && (
            <li>Part of a {stats.longestWinStreak}-game win streak.</li>
          )}
          {stats.bestGame && (
            <li>
              Best game: {gameLine(stats.bestGame)},{" "}
              {dayLabel(stats.bestGame.day)}.
            </li>
          )}
          {stats.biggestInning && (
            <li>
              Biggest inning: {plural(stats.biggestInning.runs, "run")} against{" "}
              {stats.biggestInning.opponent},{" "}
              {dayLabel(stats.biggestInning.day)}.
            </li>
          )}
          {stats.liveGames > 0 && (
            <li>
              {plural(
                stats.liveGames,
                "of those games was",
                "of those games were",
              )}{" "}
              scored live, inning by inning.
            </li>
          )}
        </ul>
      </section>

      {(stats.superlatives.length > 0 ||
        sportsmanshipShout(stats.sportsmanship) ||
        stats.subGames > 0) && (
        <section
          aria-labelledby="season-superlatives"
          className="flex flex-col gap-3"
        >
          <h2 id="season-superlatives" className="text-h2">
            League bragging rights
          </h2>
          <ul className="flex flex-wrap gap-2">
            {stats.superlatives.map((line) => (
              <li key={line} className="sticker">
                {line}
              </li>
            ))}
          </ul>
          {sportsmanshipShout(stats.sportsmanship) && (
            <p>{sportsmanshipShout(stats.sportsmanship)}.</p>
          )}
          {stats.subGames > 0 && (
            <p>Subbed for other teams in {plural(stats.subGames, "game")}.</p>
          )}
        </section>
      )}

      <section aria-labelledby="season-awards" className="flex flex-col gap-3">
        <h2 id="season-awards" className="text-h2">
          Awards
        </h2>
        {stats.awardsWon.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {stats.awardsWon.map((a) => (
              <li key={a.title} className="sticker">
                {a.team ? `Team: ${a.title}` : a.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-muted">No awards this season. Next time!</p>
        )}
        <p>
          {stats.votesCast > 0
            ? `Voted in ${plural(stats.votesCast, "award poll")}.`
            : "Sat out the award polls this time."}
        </p>
      </section>
    </article>
  );
}
