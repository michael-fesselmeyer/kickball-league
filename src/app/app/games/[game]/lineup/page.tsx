import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { lineupGame, savedLineups } from "@/db/queries/lineups";
import { type GameId, parseId } from "@/domain/ids";
import { isGameDay, lineupAccess } from "@/domain/lineup/access";
import { ordinal } from "@/domain/lineup/order";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Kicking orders" };

export default function LineupsPage(
  props: PageProps<"/app/games/[game]/lineup">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="min-h-svh">Loading the lineups…</p>}>
        <Lineups {...props} />
      </Suspense>
    </main>
  );
}

const whenIn = (timeZone: string, d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

/**
 * Both teams' kicking orders for a game, as far as the viewer may see them:
 * their own team's captains (and admins) any time, the other captain and
 * the ref from game day, names only. Everyone in an order sees their spot.
 */
async function Lineups({ params }: PageProps<"/app/games/[game]/lineup">) {
  const { game: rawGame } = await params;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawGame}/lineup`,
  });
  const gameId = parseId<GameId>(rawGame);
  const g = gameId ? await lineupGame(db, gameId) : null;
  if (!g) notFound();
  const saved = await savedLineups(db, g.id);
  const now = new Date();
  const teams = [
    { id: g.teamAId, name: g.teamAName },
    { id: g.teamBId, name: g.teamBName },
  ].map((t) => {
    const lineup = saved.get(t.id);
    const at =
      lineup?.spots.findIndex((s) => s.userId === subject.userId) ?? -1;
    return {
      ...t,
      lineup,
      access: lineupAccess(subject, g, t.id, now),
      mine:
        lineup && at !== -1
          ? { position: at + 1, of: lineup.spots.length }
          : null,
    };
  });
  // Nothing to see here for someone with no part in either order.
  if (teams.every((t) => t.access === "none" && t.mine === null)) notFound();
  const gameDay = isGameDay(g.startsAt, now, g.timeZone);

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {g.startsAt ? whenIn(g.timeZone, g.startsAt) : "Not placed yet"}
          {g.fieldName && ` · ${g.fieldName}`}
        </p>
        <h1 className="text-h2">
          Kicking orders: {g.teamAName} vs {g.teamBName}
        </h1>
      </header>
      {teams.map((t) => (
        <section
          key={t.id}
          aria-labelledby={`team-${t.id}`}
          className="flex flex-col gap-2 rounded-lg border border-border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`team-${t.id}`} className="text-h3">
              {t.name}
            </h2>
            {t.access === "edit" && (
              <Link
                href={`/app/games/${g.id}/lineup/${t.id}`}
                className="btn btn-primary"
              >
                {t.lineup ? "Edit the order" : "Build the order"}
              </Link>
            )}
          </div>
          {t.mine && (
            <p className="text-h3">
              You kick {ordinal(t.mine.position)} of {t.mine.of}.
            </p>
          )}
          {t.access === "none" ? (
            !t.mine && (
              <p className="text-small text-text-muted">
                {gameDay
                  ? "Only this team's captains and the ref see its order."
                  : "This team's order is shown to the ref and the other captain on game day."}
              </p>
            )
          ) : !t.lineup ? (
            <p className="text-small text-text-muted">No order saved yet.</p>
          ) : (
            <>
              <p className="text-small text-text-muted">
                {t.lineup.runBreaks === 0
                  ? "Keeps to the two-in-a-row rule as saved."
                  : `Saved with ${t.lineup.runBreaks === 1 ? "one place" : `${t.lineup.runBreaks} places`} where more than two of a side kick in a row.`}
              </p>
              <ol className="flex flex-col">
                {t.lineup.spots.map((s, i) => (
                  <li
                    key={s.userId}
                    className="flex gap-3 border-t border-border py-1"
                  >
                    <span className="w-7 text-right text-text-muted tabular-nums">
                      {i + 1}
                    </span>
                    <span>
                      {s.name}
                      {s.pickup && (
                        <span className="text-text-muted"> · pickup</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      ))}
    </>
  );
}
