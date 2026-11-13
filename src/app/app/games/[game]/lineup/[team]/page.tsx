import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  lineupCandidates,
  lineupGame,
  previousLineup,
  savedLineups,
} from "@/db/queries/lineups";
import { teamRsvps } from "@/db/queries/rsvps";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId, type TeamSeasonId } from "@/domain/ids";
import { reconcile } from "@/domain/lineup/order";
import { requirePermission } from "@/lib/auth/permission";
import { saveLineupAction } from "../actions";
import { LineupBuilder } from "./builder";

export const metadata: Metadata = { title: "Kicking order" };

export default function LineupBuilderPage(
  props: PageProps<"/app/games/[game]/lineup/[team]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="min-h-svh">Loading the lineup…</p>}>
        <Builder {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  not_your_game: "That team doesn't play in this game.",
  game_over: "This game is over, so its kicking order is locked.",
  empty: "Add at least one kicker before saving.",
  not_available:
    "Someone in that order isn't coming any more. The list below is up to date; save again.",
  repeated: "Someone was in the order twice. Save again.",
};

/** "Mon, Sep 14, 8:00 PM" in the league's time zone. */
const whenIn = (timeZone: string, d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

async function Builder({
  params,
  searchParams,
}: PageProps<"/app/games/[game]/lineup/[team]">) {
  const { game: rawGame, team: rawTeam } = await params;
  const query = await searchParams;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawGame}/lineup/${rawTeam}`,
  });
  const gameId = parseId<GameId>(rawGame);
  const teamSeasonId = parseId<TeamSeasonId>(rawTeam);
  if (!gameId || !teamSeasonId) notFound();
  const g = await lineupGame(db, gameId);
  if (
    !g ||
    (teamSeasonId !== g.teamAId && teamSeasonId !== g.teamBId) ||
    !can(subject, "lineup.edit", { teamSeasonId })
  )
    notFound();
  const [kickers, saved, previous, rsvps] = await Promise.all([
    lineupCandidates(db, g.id, teamSeasonId, new Date()),
    savedLineups(db, g.id),
    previousLineup(db, g.id, teamSeasonId),
    teamRsvps(db, teamSeasonId, [g.id]),
  ]);
  const mine = saved.get(teamSeasonId);
  const start = reconcile(mine?.spots.map((s) => s.userId) ?? [], kickers);
  const [teamName, opponent] =
    teamSeasonId === g.teamAId
      ? [g.teamAName, g.teamBName]
      : [g.teamBName, g.teamAName];
  const over = ["final", "forfeit", "cancelled"].includes(g.status);
  const fielding = rsvps.get(g.id)?.fielding;
  const noSide = kickers.filter((k) => k.side === null);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const savedBreaks =
    typeof query.saved === "string" ? Number(query.saved) : null;
  const teamPage = `/app/seasons/${g.seasonSlug}/team`;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {g.startsAt ? whenIn(g.timeZone, g.startsAt) : "Not placed yet"}
          {g.fieldName && ` · ${g.fieldName}`}
        </p>
        <h1 className="text-h2">
          {teamName} vs {opponent}
        </h1>
        <p className="text-small text-text-muted">
          League rule 2.2.4: no more than two players of the same gender kick in
          a row, and the order wraps from the last kicker to the first. Only
          you, your co-captains and the league see the side each player counts
          toward.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {savedBreaks !== null && !error && (
        <p role="status" className="rounded-lg border border-success p-3">
          {savedBreaks === 0
            ? "Saved. Your players can see their spots, and on game day so can the ref and the other captain."
            : "Saved, with rule breaks still in it. The ref has the final say on the field."}
        </p>
      )}

      {fielding && fielding.level !== "full" && (
        <p
          className={`rounded-lg border p-3 text-small ${
            fielding.level === "forfeit" ? "border-danger" : "border-warning"
          }`}
        >
          {fielding.message}{" "}
          <Link href={`${teamPage}#game-${g.id}`} className="underline">
            See RSVPs
          </Link>
        </p>
      )}

      {noSide.length > 0 && (
        <p className="rounded-lg border border-border p-3 text-small">
          {noSide.map((k) => k.name).join(", ")}{" "}
          {noSide.length === 1 ? "hasn't" : "haven't"} chosen a side for the
          gender rules in their profile, so here they count toward neither side.
          Ask them to fill it in; the ref has the final say.
        </p>
      )}

      {over ? (
        <p>This game is over, so its kicking order is locked.</p>
      ) : kickers.length === 0 ? (
        <p className="text-text-muted">
          Nobody has said they&apos;re in for this game yet.{" "}
          <Link href={`${teamPage}#game-${g.id}`} className="underline">
            Back to the team page
          </Link>
        </p>
      ) : (
        <LineupBuilder
          // A fresh start after each save, from the order as saved.
          key={mine?.savedAt.toISOString() ?? "new"}
          kickers={kickers}
          initial={start.order.map((k) => k.id)}
          previous={previous?.order ?? null}
          saved={mine !== undefined}
          save={saveLineupAction.bind(null, g.id, teamSeasonId)}
        />
      )}
      {mine && start.dropped.length > 0 && (
        <p className="text-small text-text-muted">
          {start.dropped.length} from the saved order{" "}
          {start.dropped.length === 1 ? "isn't" : "aren't"} coming any more and
          {start.dropped.length === 1 ? " was" : " were"} left out. Save to
          update it.
        </p>
      )}
      <Link href={`/app/games/${g.id}/lineup`} className="underline">
        See both teams&apos; orders
      </Link>
    </>
  );
}
