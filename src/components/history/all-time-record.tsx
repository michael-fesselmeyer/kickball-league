import Link from "next/link";
import { db } from "@/db/client";
import { teamHistory } from "@/db/queries/history";
import type { TeamId } from "@/domain/ids";
import { pctText, recordLine, signedText } from "@/domain/history/history";

type Props = { team: { id: TeamId; slug: string; name: string } };

/** A team's record over every season it played, and the titles it won. */
export async function AllTimeRecord({ team }: Props) {
  const { record, titles } = await teamHistory(db, team.id, team.slug);
  if (record.played === 0) return null;
  const stats = [
    { label: "Wins, losses, ties", value: recordLine(record), wide: true },
    { label: "Seasons", value: String(record.seasons) },
    { label: "Win pct", value: pctText(record.winPct) },
    { label: "Run diff", value: signedText(record.runDifference) },
    { label: "Titles", value: String(record.titles) },
  ];
  return (
    <section aria-labelledby="all-time" className="flex flex-col gap-3">
      <h2 id="all-time" className="text-h2">
        All-time
      </h2>
      <dl className="grid grid-cols-2 gap-2 text-center">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`flex flex-col-reverse gap-1 rounded-card border border-border bg-surface p-3 ${s.wide ? "col-span-2" : ""}`}
          >
            <dt className="text-micro font-bold tracking-wide text-text-muted uppercase">
              {s.label}
            </dt>
            <dd
              className={`font-display tabular-nums ${s.wide ? "text-h2" : "text-h3"}`}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
      {titles.length > 0 && (
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-bold">
            {titles.length === 1
              ? "Champions"
              : `${titles.length}-time champions`}
          </span>
          {titles.map((t) => (
            <span key={t.slug} className="sticker">
              {t.name}
            </span>
          ))}
        </p>
      )}
      <p className="text-small text-text-muted">
        Regular-season games in every season {team.name} played.{" "}
        <Link href="/history" className="underline">
          League history
        </Link>
      </p>
    </section>
  );
}
