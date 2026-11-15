import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  checklistGame,
  fieldChecksOn,
  seasonChecklist,
  ticksFor,
} from "@/db/queries/game-day-checklist";
import { can } from "@/domain/authz/permissions";
import { CHECKLIST_PHASES, PHASE_LABELS } from "@/domain/gameday/checklist";
import { type GameId, parseId } from "@/domain/ids";
import { fullWhen } from "@/domain/schedule/format";
import { localDay } from "@/domain/schedule/public-game";
import { requirePermission } from "@/lib/auth/permission";
import { leadsSetupOn } from "@/lib/gameday/setup-lead";
import { FieldCheckForm, gameDayError } from "@/components/field-check-form";
import { PageLoading } from "@/components/page-loading";
import { closeFieldAction } from "./actions";
import { ChecklistTicks } from "./ticks";

export const metadata: Metadata = {
  title: "Game-day checklist",
  robots: { index: false },
};

/**
 * A game's checklist on game day (issue #409): the season's before and
 * after items, ticked by each team's captains, and after the last game at
 * the field, the "Field left clean" check for its ref, a captain or the
 * set-up lead. The home screen saves this page on the phone with the next
 * game, and ticks made without signal send when it is back.
 */
export default function ChecklistPage(
  props: PageProps<"/app/games/[game]/checklist">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading the checklist…</PageLoading>}>
        <Checklist {...props} />
      </Suspense>
    </main>
  );
}

async function Checklist({
  params,
  searchParams,
}: PageProps<"/app/games/[game]/checklist">) {
  const { game: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/checklist`,
  });
  const gameId = parseId<GameId>(rawId);
  const g = gameId ? await checklistGame(db, gameId) : null;
  if (!g) notFound();
  const setupLead = await leadsSetupOn(subject, g);
  const context = {
    leagueId: g.leagueId,
    game: { id: g.id, teamSeasonIds: g.teamSeasonIds },
    setupLead,
  };
  const mine = g.teams.filter((t) =>
    can(subject, "game_checklist.tick", {
      leagueId: g.leagueId,
      teamSeasonId: t.id,
    }),
  );
  const mayClose = can(subject, "field_check.close", context);
  // Only the game's captains, its ref, the set-up lead and admins learn
  // that the page exists.
  if (mine.length === 0 && !mayClose) notFound();

  const today = localDay(new Date(), g.timeZone);
  const header = (
    <header className="flex flex-col gap-1">
      <p className="text-text-muted">
        {g.teams.map((t) => t.name).join(" vs ")} ·{" "}
        {fullWhen(g.startsAt, g.timeZone)} · {g.fieldName}
      </p>
      <h1 className="text-h1">Game-day checklist</h1>
    </header>
  );
  if (today !== g.date)
    return (
      <>
        {header}
        <p>The checklist opens on game day.</p>
        <Link href="/app" className="underline">
          Back to your home screen
        </Link>
      </>
    );

  const [list, ticks, checks] = await Promise.all([
    seasonChecklist(db, g.seasonId),
    ticksFor(
      db,
      g.id,
      mine.map((t) => t.id),
    ),
    g.lastOnField ? fieldChecksOn(db, g.seasonId, g.date) : null,
  ]);
  const phases = CHECKLIST_PHASES.map((p) => ({
    label: PHASE_LABELS[p],
    items: list.items[p],
  }));
  const error = gameDayError(
    typeof query.error === "string" ? query.error : undefined,
  );

  return (
    <>
      {header}
      {mine.map((t) => (
        <ChecklistTicks
          key={t.id}
          userId={subject.userId}
          gameId={g.id}
          teamSeasonId={t.id}
          teamName={t.name}
          phases={phases}
          ticked={[...(ticks.get(t.id) ?? [])]}
        />
      ))}
      {mine.length === 0 && (
        <section className="flex flex-col gap-2">
          {phases.map((p) => (
            <div key={p.label}>
              <h2 className="text-h3">{p.label}</h2>
              <ul className="list-disc pl-6">
                {p.items.map((i) => (
                  <li key={i.id}>{i.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {g.lastOnField && mayClose && (
        <section
          id="close"
          aria-labelledby="close-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="close-heading" className="text-h2">
            After the last game here
          </h2>
          <p className="text-small text-text-muted">
            This is the last game on {g.fieldName} today. Once play is over,
            confirm the field was left clean or say what went wrong.
          </p>
          {error && (
            <p role="alert" className="rounded-lg border-2 border-danger p-3">
              {error}
            </p>
          )}
          {query.notice === "closed" && (
            <p role="status" className="font-bold">
              Saved. Thanks for closing out the field.
            </p>
          )}
          <FieldCheckForm
            kind="close"
            action={closeFieldAction.bind(null, g.id)}
            saved={checks?.get(g.fieldId)?.close ?? null}
            timeZone={g.timeZone}
            idPrefix="close"
          />
        </section>
      )}
      <Link href="/app" className="underline">
        Back to your home screen
      </Link>
    </>
  );
}
