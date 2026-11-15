import Link from "next/link";
import type { CSSProperties } from "react";
import type { BracketView, BracketViewMatch } from "@/db/queries/playoffs";
import {
  boardColumns,
  losersColumns,
  sourceLabel,
  tierName,
} from "@/domain/playoffs/playoffs";
import { stageRoundName } from "@/domain/scheduler/bracket";
import { kickoff, shortDay } from "@/domain/schedule/format";
import "./bracket.css";
import { type LeagueRef, leagueHref } from "@/domain/league/paths";

/** Class names from bracket.css. */
const styles = {
  board: "bracket-board",
  bye: "bracket-bye",
  champion: "bracket-champion",
  dot: "bracket-dot",
  final: "bracket-final",
  in: "bracket-in",
  loser: "bracket-loser",
  match: "bracket-match",
  out: "bracket-out",
  place: "bracket-place",
  places: "bracket-places",
  round: "bracket-round",
  roundName: "bracket-round-name",
  score: "bracket-score",
  scroller: "bracket-scroller",
  seed: "bracket-seed",
  side: "bracket-side",
  tbd: "bracket-tbd",
  team: "bracket-team",
  when: "bracket-when",
  winner: "bracket-winner",
  won: "bracket-won",
} as const;

/**
 * The playoff bracket, drawn as a board or read as a plain list. Both are
 * server-rendered lists of text; the board's motion is CSS only and stops
 * under reduced motion.
 */

type Side = BracketViewMatch["teamA"];

function when(m: BracketViewMatch, timeZone: string): string {
  if (!m.startsAt)
    return m.fieldName ? `${m.fieldName}, time to be set` : "Time to be set";
  const at = `${shortDay(m.startsAt, timeZone)}, ${kickoff(m.startsAt, timeZone)}`;
  return m.fieldName ? `${at}, ${m.fieldName}` : at;
}

function result(m: BracketViewMatch): string | null {
  if (m.status === "forfeit") return "Forfeit";
  if (m.status === "final" && m.scoreA !== null && m.scoreB !== null)
    return `${m.scoreA}–${m.scoreB}`;
  return null;
}

function TeamName({
  side,
  league,
}: {
  side: NonNullable<Side>;
  /** The league whose team pages to link to; null for no links. */
  league: LeagueRef | null;
}) {
  return (
    <span className={styles.team}>
      <span
        aria-hidden="true"
        className={styles.dot}
        style={{ background: side.colorHex ?? "transparent" }}
      />
      {league && side.slug ? (
        <Link
          href={leagueHref(league, `/teams/${side.slug}`)}
          className="underline"
        >
          {side.name}
        </Link>
      ) : (
        <span>{side.name}</span>
      )}
    </span>
  );
}

function MatchSide({
  side,
  label,
  score,
  winnerId,
  league,
}: {
  side: Side;
  label: string;
  score: number | null;
  winnerId: string | null;
  league: LeagueRef | null;
}) {
  const won = side !== null && winnerId === side.id;
  const lost = side !== null && winnerId !== null && !won;
  return (
    <li
      className={`${styles.side} ${won ? styles.winner : ""} ${lost ? styles.loser : ""}`}
    >
      <span className={styles.seed}>{side?.seed ?? ""}</span>
      {side ? (
        <TeamName side={side} league={league} />
      ) : (
        <span className={styles.tbd}>{label}</span>
      )}
      <span className={styles.score}>
        {score ?? ""}
        {won && <span className="sr-only"> (won)</span>}
      </span>
    </li>
  );
}

/** Game numbers by match code, for "Winner of game 3" labels. */
const numbersOf = (bracket: BracketView) =>
  new Map(bracket.matches.map((m) => [m.code, m.gameNo]));

/** The heading for a round of a stage, in this bracket's format. */
const nameOf = (
  bracket: BracketView,
  m: { stage: BracketViewMatch["stage"]; round: number },
) => stageRoundName(m.stage, m.round, bracket.rounds, bracket.format);

/** "Game 5 · 7 innings": the game's number, and its length when set. */
function gameLine(m: BracketViewMatch): string {
  return m.innings
    ? `Game ${m.gameNo} · ${m.innings} innings`
    : `Game ${m.gameNo}`;
}

/** The finals after the main side: grand finals, or the third-place game. */
function finals(bracket: BracketView): BracketViewMatch[] {
  const order = { grand_final: 0, reset: 1, third_place: 2 } as const;
  return bracket.matches
    .filter(
      (m): m is BracketViewMatch & { stage: keyof typeof order } =>
        m.stage in order,
    )
    .sort((a, b) => order[a.stage] - order[b.stage]);
}

function MatchCard({
  bracket,
  m,
  league,
  numbers,
}: {
  bracket: BracketView;
  m: BracketViewMatch;
  league: LeagueRef | null;
  numbers: ReadonlyMap<string, number>;
}) {
  const name = nameOf(bracket, m);
  const status = m.skipped
    ? "Not needed"
    : result(m)
      ? `Final · ${when(m, bracket.timeZone)}`
      : when(m, bracket.timeZone);
  return (
    <article className={styles.match} aria-label={`Game ${m.gameNo}, ${name}`}>
      <p className={styles.when}>
        {gameLine(m)}
        {m.stage === "reset" ? " · if necessary" : ""}
      </p>
      <ul>
        <MatchSide
          side={m.teamA}
          label={sourceLabel(m.sourceA, numbers)}
          score={m.scoreA}
          winnerId={m.winnerId}
          league={league}
        />
        <MatchSide
          side={m.teamB}
          label={sourceLabel(m.sourceB, numbers)}
          score={m.scoreB}
          winnerId={m.winnerId}
          league={league}
        />
      </ul>
      <p className={styles.when}>{status}</p>
    </article>
  );
}

export function BracketBoard({
  bracket,
  league,
  headingLevel = 2,
  name,
}: {
  bracket: BracketView;
  /** The league whose team pages to link to; null for no links. */
  league: LeagueRef | null;
  /** The round names' heading level, below the page's own headings. */
  headingLevel?: 2 | 3;
  /** Whose bracket, when a page shows more than one. */
  name?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const columns = boardColumns(bracket.size, bracket.matches);
  const seedTeam = new Map(bracket.seeds.map((s) => [s.seed, s.team]));
  const numbers = numbersOf(bracket);
  const double = bracket.format === "double_elimination";
  const losers = losersColumns(bracket.matches);
  const last = finals(bracket);
  const whose = name ? `${name} bracket` : "Playoff bracket";
  return (
    <div className="flex flex-col gap-4">
      <div
        className={styles.scroller}
        role="region"
        aria-label={`${whose}${double ? ", winners' side" : ""}; scrolls sideways on small screens`}
        // A scrolling region must be reachable by keyboard, even with no links.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <ol className={styles.board}>
          {columns.map(({ round, cells }) => {
            // The single-elimination final ends the board; a winners'
            // final feeds the grand final, drawn below.
            const end = round === bracket.rounds;
            return (
              <li
                key={round}
                className={`${styles.round} ${end && !double ? styles.final : ""}`}
                style={{ "--round": round } as CSSProperties}
              >
                <Heading className={styles.roundName}>
                  {nameOf(bracket, { stage: "main", round })}
                </Heading>
                <ol className={styles.places}>
                  {cells.map((cell, i) => {
                    if (cell.kind === "bye") {
                      const team = seedTeam.get(cell.seed);
                      return (
                        <li
                          key={`bye-${i}`}
                          className={`${styles.place} ${styles.out}`}
                        >
                          <p className={styles.bye}>
                            {team
                              ? `(${cell.seed}) ${team.name} has a bye`
                              : "Bye"}
                          </p>
                        </li>
                      );
                    }
                    const m = cell.match;
                    return (
                      <li
                        key={m.code}
                        className={`${styles.place} ${end ? "" : styles.out} ${round > 1 ? styles.in : ""} ${m.winnerId ? styles.won : ""}`}
                      >
                        <MatchCard
                          bracket={bracket}
                          m={m}
                          league={league}
                          numbers={numbers}
                        />
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      </div>
      {losers.length > 0 && (
        <div
          className={styles.scroller}
          role="region"
          aria-label={`${whose}, losers' side; scrolls sideways on small screens`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <ol className={styles.board}>
            {losers.map(({ round, matches }) => (
              <li key={round} className={styles.round}>
                <Heading className={styles.roundName}>
                  {nameOf(bracket, { stage: "losers", round })}
                </Heading>
                <ol className={styles.places}>
                  {matches.map((m) => (
                    <li
                      key={m.code}
                      className={`${styles.place} ${m.winnerId ? styles.won : ""}`}
                    >
                      <MatchCard
                        bracket={bracket}
                        m={m}
                        league={league}
                        numbers={numbers}
                      />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </div>
      )}
      {last.length > 0 && (
        <ol className={styles.board}>
          {last.map((m) => (
            <li
              key={m.code}
              className={`${styles.round} ${m.stage === "third_place" ? "" : styles.final}`}
            >
              <Heading className={styles.roundName}>
                {nameOf(bracket, m)}
              </Heading>
              <MatchCard
                bracket={bracket}
                m={m}
                league={league}
                numbers={numbers}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The same bracket as a plain list, round by round, in the order played. */
export function BracketList({
  bracket,
  headingLevel = 2,
  idPrefix = "",
}: {
  bracket: BracketView;
  /** The round names' heading level, below the page's own headings. */
  headingLevel?: 2 | 3;
  /** Keeps ids unique when a page shows more than one bracket. */
  idPrefix?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const columns = boardColumns(bracket.size, bracket.matches);
  const seedTeam = new Map(bracket.seeds.map((s) => [s.seed, s.team]));
  const numbers = numbersOf(bracket);
  const name = (side: Side, source: BracketViewMatch["sourceA"]) =>
    side
      ? `${side.seed ? `(${side.seed}) ` : ""}${side.name}`
      : sourceLabel(source, numbers);
  type Cell = (typeof columns)[number]["cells"][number];
  const sections: { key: string; title: string; cells: Cell[] }[] = [
    ...columns.map(({ round, cells }) => ({
      key: `round-${round}`,
      title: nameOf(bracket, { stage: "main", round }),
      cells,
    })),
    ...losersColumns(bracket.matches).map(({ round, matches }) => ({
      key: `losers-${round}`,
      title: nameOf(bracket, { stage: "losers", round }),
      cells: matches.map((match): Cell => ({ kind: "match", match })),
    })),
    ...finals(bracket).map((m) => ({
      key: m.code,
      title: nameOf(bracket, m),
      cells: [{ kind: "match" as const, match: m }],
    })),
  ];
  return (
    <div className="flex flex-col gap-6">
      {sections.map(({ key, title, cells }) => (
        <section
          key={key}
          aria-labelledby={`${idPrefix}${key}`}
          className="flex flex-col gap-2"
        >
          <Heading id={`${idPrefix}${key}`} className="text-h3">
            {title}
          </Heading>
          <ul className="flex flex-col gap-2">
            {cells.map((cell, i) => {
              if (cell.kind === "bye") {
                const team = seedTeam.get(cell.seed);
                return (
                  <li key={`bye-${i}`} className="text-text-muted">
                    {team ? `(${cell.seed}) ${team.name}` : "A team"} has a bye
                    to the next round.
                  </li>
                );
              }
              const m = cell.match;
              const score = result(m);
              const winner =
                m.winnerId === m.teamA?.id
                  ? m.teamA
                  : m.winnerId === m.teamB?.id
                    ? m.teamB
                    : null;
              const title =
                bracket.champion?.id === m.winnerId &&
                (m.stage === "grand_final" ||
                  m.stage === "reset" ||
                  (m.stage === "main" &&
                    bracket.format === "single_elimination" &&
                    m.round === bracket.rounds));
              return (
                <li
                  key={m.code}
                  className="rounded-card border border-border bg-surface p-3"
                >
                  <p className="text-small text-text-muted">
                    {gameLine(m)}
                    {m.stage === "reset"
                      ? " · played only if the winners' side champion loses the grand final"
                      : ""}
                  </p>
                  <p className="font-bold">
                    {name(m.teamA, m.sourceA)} vs {name(m.teamB, m.sourceB)}
                  </p>
                  <p className="text-small text-text-muted">
                    {m.skipped ? "Not needed" : when(m, bracket.timeZone)}
                  </p>
                  {winner && (
                    <p className="text-small">
                      {score ? `Final, ${score}. ` : ""}
                      {winner.name} {title ? "wins it all" : "wins"}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The champion, once the title is decided. */
export function Champion({ bracket }: { bracket: BracketView }) {
  if (!bracket.champion) return null;
  const whose = bracket.division
    ? `${bracket.division.name} champions`
    : bracket.tier > 1
      ? `${tierName(bracket.tier)} champions`
      : "champions";
  return (
    <p className={`sticker ${styles.champion}`}>
      <span aria-hidden="true">🏆</span>
      {bracket.champion.name}: {whose}
    </p>
  );
}
