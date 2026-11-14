import Link from "next/link";
import type { AwardsBoard, ShownPlace } from "@/db/queries/stat-awards";
import {
  coverageNote,
  formatValue,
  MVP_PART_LABELS,
  type MvpPart,
  MVP_PARTS,
  type MvpWeights,
  partsLine,
  STAT_AWARD_KEYS,
  STAT_AWARDS,
  type StatAward,
} from "@/domain/awards/stat-awards";

/** Winners named in the award's headline; more read as a count. */
const NAMED_WINNERS = 4;
/** Places listed under an award; a long tie is counted, not listed. */
const LISTED = 8;

/** One place: its number, the name and team, and the number behind it. */
function Place({ p, unused }: { p: ShownPlace; unused: readonly MvpPart[] }) {
  const covered =
    p.detail.recorded !== undefined && p.detail.of !== undefined
      ? coverageNote(p.detail.recorded, p.detail.of)
      : null;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border py-2">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="w-6 shrink-0 text-text-muted tabular-nums">
          {p.place}.
        </span>
        <span className="min-w-0 break-words">
          <strong>{p.name}</strong>
          {p.teamName && (
            <span className="text-text-muted">
              {" "}
              ·{" "}
              {p.teamSlug ? (
                <Link href={`/teams/${p.teamSlug}`} className="underline">
                  {p.teamName}
                </Link>
              ) : (
                p.teamName
              )}
            </span>
          )}
        </span>
      </span>
      <span className="text-small text-text-muted tabular-nums">
        {formatValue(p.award, p.value)}
        {covered && <> ({covered})</>}
      </span>
      {p.detail.parts && (
        <span className="w-full pl-8 text-small text-text-muted">
          {partsLine(p.detail.parts, unused)}
        </span>
      )}
    </li>
  );
}

/** The MVP weights as a sentence-sized list. */
export function WeightsList({
  weights,
  unused,
}: {
  weights: MvpWeights;
  unused: readonly string[];
}) {
  const total = MVP_PARTS.reduce((n, p) => n + weights[p], 0);
  return (
    <ul className="flex flex-col gap-1 text-small">
      {MVP_PARTS.map((part) => (
        <li key={part} className="flex justify-between gap-3">
          <span>
            {MVP_PART_LABELS[part]}
            {unused.includes(part) && (
              <span className="text-text-muted"> (no data this season)</span>
            )}
          </span>
          <span className="tabular-nums">
            {weights[part]} of {total}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Award({
  award,
  board,
  places,
}: {
  award: StatAward;
  board: AwardsBoard;
  places: ShownPlace[];
}) {
  const info = STAT_AWARDS[award];
  const winners = places.filter((p) => p.place === 1);
  const note = board.notes[award];
  const id = `award-${award}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id={id} className="text-h2">
          {info.label}
        </h2>
        <p className="text-text-muted">{info.blurb}</p>
      </header>
      {winners.length === 0 ? (
        <p>No one qualified this season.</p>
      ) : winners.length > NAMED_WINNERS ? (
        <p className="text-h3">Shared by {winners.length} players</p>
      ) : (
        <p className="text-h3">
          {winners.length > 1 ? "Shared by " : ""}
          {winners.map((w, i) => (
            <span key={w.userId}>
              {i > 0 && (i === winners.length - 1 ? " and " : ", ")}
              <strong>{w.name}</strong>
            </span>
          ))}
        </p>
      )}
      {note && <p className="border-l-4 border-brand pl-3">{note}</p>}
      {places.length > 0 && (
        <ol aria-label={`${info.label} leaders`} className="flex flex-col">
          {places.slice(0, LISTED).map((p) => (
            <Place key={p.userId} p={p} unused={board.unusedParts} />
          ))}
        </ol>
      )}
      {places.length > LISTED && (
        <p className="text-small text-text-muted">
          And {places.length - LISTED} more tied with the last one listed.
        </p>
      )}
      <details className="text-small">
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
          How it&apos;s worked out
        </summary>
        <div className="flex flex-col gap-2 pt-1">
          <p>{info.formula}</p>
          {(award === "season_mvp" || award === "rookie_of_the_year") && (
            <>
              <WeightsList weights={board.weights} unused={board.unusedParts} />
              {!board.votesCounted && (
                <p className="text-text-muted">
                  No season MVP poll had closed with votes, so votes were not
                  part of the score.
                </p>
              )}
            </>
          )}
          <p className="text-text-muted">
            A stat counts once at least 3 games, and at least half of the games,
            recorded it. Ties share the award.
          </p>
        </div>
      </details>
    </section>
  );
}

/** Every stat award of a season, in a fixed order. */
export function AwardsBoardView({ board }: { board: AwardsBoard }) {
  return (
    <div className="flex flex-col gap-4">
      {STAT_AWARD_KEYS.map((award) => (
        <Award
          key={award}
          award={award}
          board={board}
          places={board.places.filter((p) => p.award === award)}
        />
      ))}
    </div>
  );
}
