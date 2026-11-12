import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { finalizeDueScores, scoresNeedingAttention } from "@/db/queries/scores";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Scores" };

export default function ScoresPage(
  props: PageProps<"/app/admin/seasons/[season]/scores">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Scores {...props} />
      </Suspense>
    </main>
  );
}

async function Scores({
  params,
}: PageProps<"/app/admin/seasons/[season]/scores">) {
  const { season: slug } = await params;
  await requirePermission("score.override", {
    next: `/app/admin/seasons/${slug}/scores`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const now = new Date();
  // Settle anything past its 24 hours before listing what is left.
  await txDb.transaction((tx) => finalizeDueScores(tx, now));
  const games = await scoresNeedingAttention(db, season.id, now);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: season.timeZone,
    }).format(d);
  const groups = [
    {
      id: "disputed",
      title: "Disputed",
      hint: "A captain disputed the reported score. Set the final score.",
      games: games.filter((g) => g.state.state === "disputed"),
    },
    {
      id: "missing",
      title: "Missing scores",
      hint: "The game has started and nobody has reported a score.",
      games: games.filter((g) => g.state.state === "none"),
    },
    {
      id: "awaiting",
      title: "Waiting for confirmation",
      hint: "Final when the other team confirms, or 24 hours after the report.",
      games: games.filter((g) => g.state.state === "awaiting"),
    },
  ];

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Scores</h1>
        <p className="text-text-muted">
          {games.length === 0
            ? "Every game that has started has a final score."
            : `${games.length} ${games.length === 1 ? "game needs" : "games need"} a look.`}
        </p>
      </header>
      {groups.map(
        (group) =>
          group.games.length > 0 && (
            <section
              key={group.id}
              aria-labelledby={group.id}
              className="flex flex-col gap-2"
            >
              <h2 id={group.id} className="text-h2">
                {group.title} ({group.games.length})
              </h2>
              <p className="text-small text-text-muted">{group.hint}</p>
              <ul className="flex flex-col">
                {group.games.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                  >
                    <span>
                      {g.teams}
                      <span className="text-text-muted">
                        {" "}
                        · {when(g.startsAt)}
                      </span>
                    </span>
                    <Link
                      href={`/app/games/${g.id}/score`}
                      className="underline"
                    >
                      {group.id === "awaiting" ? "See score" : "Set score"}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </>
  );
}
