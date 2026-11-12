import Link from "next/link";
import type { CSSProperties } from "react";
import type { BracketView, BracketViewMatch } from "@/db/queries/playoffs";
import {
  boardColumns,
  roundName,
  sourceLabel,
} from "@/domain/playoffs/playoffs";
import { kickoff, shortDay } from "@/domain/schedule/format";
import styles from "./bracket.module.css";

/**
 * The playoff bracket, drawn as a board or read as a plain list. Both are
 * server-rendered lists of text; the board's motion is CSS only and stops
 * under reduced motion.
 */

type Side = BracketViewMatch["teamA"];

function when(m: BracketViewMatch, timeZone: string): string {
  if (!m.startsAt) return "Time to be set";
  const at = `${shortDay(m.startsAt, timeZone)}, ${kickoff(m.startsAt, timeZone)}`;
  return m.fieldName ? `${at}, ${m.fieldName}` : at;
}

function result(m: BracketViewMatch): string | null {
  if (m.status === "forfeit") return "Forfeit";
  if (m.status === "final" && m.scoreA !== null && m.scoreB !== null)
    return `${m.scoreA}–${m.scoreB}`;
  return null;
}

function TeamName({ side, link }: { side: NonNullable<Side>; link: boolean }) {
  return (
    <span className={styles.team}>
      <span
        aria-hidden="true"
        className={styles.dot}
        style={{ background: side.colorHex ?? "transparent" }}
      />
      {link && side.slug ? (
        <Link href={`/teams/${side.slug}`} className="underline">
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
  link,
}: {
  side: Side;
  label: string;
  score: number | null;
  winnerId: string | null;
  link: boolean;
}) {
  const won = side !== null && winnerId === side.id;
  const lost = side !== null && winnerId !== null && !won;
  return (
    <li
      className={`${styles.side} ${won ? styles.winner : ""} ${lost ? styles.loser : ""}`}
    >
      <span className={styles.seed}>{side?.seed ?? ""}</span>
      {side ? (
        <TeamName side={side} link={link} />
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

export function BracketBoard({
  bracket,
  link = true,
}: {
  bracket: BracketView;
  link?: boolean;
}) {
  const columns = boardColumns(bracket.size, bracket.matches);
  const seedTeam = new Map(bracket.seeds.map((s) => [s.seed, s.team]));
  return (
    <div
      className={styles.scroller}
      role="region"
      aria-label="Playoff bracket; scrolls sideways on small screens"
      // A scrolling region must be reachable by keyboard, even with no links.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      style={{ "--rounds": bracket.rounds } as CSSProperties}
    >
      <ol className={styles.board}>
        {columns.map(({ round, cells }) => {
          const last = round === bracket.rounds;
          return (
            <li
              key={round}
              className={`${styles.round} ${last ? styles.final : ""}`}
              style={{ "--round": round } as CSSProperties}
            >
              <h3 className={styles.roundName}>
                {roundName(round, bracket.rounds)}
              </h3>
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
                      className={`${styles.place} ${last ? "" : styles.out} ${round > 1 ? styles.in : ""} ${m.winnerId ? styles.won : ""}`}
                    >
                      <article
                        className={styles.match}
                        aria-label={`${roundName(round, bracket.rounds)}, game ${m.position}`}
                      >
                        <ul>
                          <MatchSide
                            side={m.teamA}
                            label={sourceLabel(m.sourceA, bracket.rounds)}
                            score={m.scoreA}
                            winnerId={m.winnerId}
                            link={link}
                          />
                          <MatchSide
                            side={m.teamB}
                            label={sourceLabel(m.sourceB, bracket.rounds)}
                            score={m.scoreB}
                            winnerId={m.winnerId}
                            link={link}
                          />
                        </ul>
                        <p className={styles.when}>
                          {result(m)
                            ? `Final · ${when(m, bracket.timeZone)}`
                            : when(m, bracket.timeZone)}
                        </p>
                      </article>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The same bracket as a plain list, round by round. */
export function BracketList({ bracket }: { bracket: BracketView }) {
  const columns = boardColumns(bracket.size, bracket.matches);
  const seedTeam = new Map(bracket.seeds.map((s) => [s.seed, s.team]));
  const name = (side: Side, source: BracketViewMatch["sourceA"]) =>
    side
      ? `${side.seed ? `(${side.seed}) ` : ""}${side.name}`
      : sourceLabel(source, bracket.rounds);
  return (
    <div className="flex flex-col gap-6">
      {columns.map(({ round, cells }) => (
        <section
          key={round}
          aria-labelledby={`round-${round}`}
          className="flex flex-col gap-2"
        >
          <h2 id={`round-${round}`} className="text-h3">
            {roundName(round, bracket.rounds)}
          </h2>
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
              return (
                <li
                  key={m.code}
                  className="rounded-card border border-border bg-surface p-3"
                >
                  <p className="font-bold">
                    {name(m.teamA, m.sourceA)} vs {name(m.teamB, m.sourceB)}
                  </p>
                  <p className="text-small text-text-muted">
                    {when(m, bracket.timeZone)}
                  </p>
                  {winner && (
                    <p className="text-small">
                      {score ? `Final, ${score}. ` : ""}
                      {winner.name}{" "}
                      {round === bracket.rounds ? "wins it all" : "moves on"}.
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

/** The champion, once the final is decided. */
export function Champion({ bracket }: { bracket: BracketView }) {
  if (!bracket.champion) return null;
  return (
    <p
      className={`sticker ${styles.champion}`}
      style={{ "--rounds": bracket.rounds } as CSSProperties}
    >
      <span aria-hidden="true">🏆</span>
      {bracket.champion.name}: champions
    </p>
  );
}
