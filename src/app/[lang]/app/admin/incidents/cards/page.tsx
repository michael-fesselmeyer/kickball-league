import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { cardedPlayers } from "@/db/queries/cards";
import { cardName, patternNote } from "@/domain/discipline/cards";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { requireFeature } from "@/lib/platform/site";

export const metadata: Metadata = { title: "Cards" };

export default function CardsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the cards…</PageLoading>}>
        <Cards />
      </Suspense>
    </main>
  );
}

async function Cards() {
  await requireFeature("discipline");
  await requirePermission("incident.review", {
    next: "/app/admin/incidents/cards",
  });
  const [players, league] = await Promise.all([
    cardedPlayers(db),
    activeLeague(),
  ]);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/incidents" className="underline">
          Incidents
        </Link>
        <h1 className="text-h1">Cards</h1>
        <p className="text-text-muted">
          Yellow and red cards refs gave as a calm-down tool. A card never
          suspends anyone. Suspensions are your call, kept for serious conduct:
          hurting someone, sexual misconduct, or repeated behavior that makes
          someone deeply uncomfortable.
        </p>
      </header>
      {players.length === 0 ? (
        <p className="text-text-muted">No cards have been given.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {players.map((p) => {
            const pattern = patternNote(p.cards);
            return (
              <li
                key={p.userId}
                className="rounded-lg border border-border p-4"
              >
                <h2 className="text-h3">{p.name}</h2>
                {pattern && <p className="text-small">{pattern}</p>}
                <ul className="mt-2 flex flex-col text-small">
                  {p.cards.map((c) => (
                    <li key={c.id} className="border-t border-border py-1">
                      <Link
                        href={`/app/games/${c.gameId}/score`}
                        className="underline"
                      >
                        {cardName(c.color)}
                      </Link>
                      <span className="text-text-muted">
                        {" "}
                        · {when(c.givenAt)} · {c.gameLabel}
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
