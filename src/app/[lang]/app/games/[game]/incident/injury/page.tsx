import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { gamePeople } from "@/db/queries/discipline";
import { gameForScoring } from "@/db/queries/scores";
import { canFileFor } from "@/domain/discipline/discipline";
import {
  BODY_AREA_KEYS,
  BODY_AREAS,
  CARE_KEYS,
  CARE_LEVELS,
  INJURY_TEXT_MAX,
  WITNESSES_MAX,
} from "@/domain/discipline/injury";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { fileInjuryAction } from "./actions";

export const metadata: Metadata = { title: "Report an injury" };

export default function InjuryPage(
  props: PageProps<"/[lang]/app/games/[game]/incident/injury">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading the game…</PageLoading>}>
        <Report {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  no_one_hurt: "Choose who was hurt.",
  unknown_person: "Pick people from the two teams in this game.",
  bad_body_area: "Choose where they were hurt.",
  bad_care: "Choose what care they needed.",
  no_details: "Say what happened.",
  details_too_long: `Keep it under ${INJURY_TEXT_MAX} characters.`,
  too_many_witnesses: `Name at most ${WITNESSES_MAX} witnesses.`,
  not_started: "This game hasn't started yet.",
  called_off: "This game was called off.",
  not_found: "That game no longer exists.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

async function Report({
  params,
  searchParams,
}: PageProps<"/[lang]/app/games/[game]/incident/injury">) {
  await requireFeature("discipline");
  const { game: rawId } = await params;
  const query = await searchParams;
  const gameId = parseId<GameId>(rawId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  await requirePermission("incident.log", {
    next: `/app/games/${rawId}/incident/injury`,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
  });
  const open = canFileFor(g, new Date());
  const people = open.ok ? await gamePeople(db, g) : [];
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const teams = [
    { id: g.teamAId, name: g.teamAName },
    { id: g.teamBId, name: g.teamBName },
  ];

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/games/${g.id}/incident`} className="underline">
          {g.teamAName} vs {g.teamBName}
        </Link>
        <h1 className="text-h1">Report an injury</h1>
        <p className="text-text-muted">
          Only the league&apos;s owners and admins can read it. It is kept for
          insurance and removed after three years. Give only what the league
          needs.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.filed ? (
        <p role="status" className="rounded-lg border border-success p-3">
          Report sent. The league&apos;s owners and admins will follow up.
        </p>
      ) : !open.ok ? (
        <p>{ERRORS[open.error]}</p>
      ) : (
        <form
          action={fileInjuryAction.bind(null, g.id)}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="injury-hurt">Who was hurt</label>
            <select
              id="injury-hurt"
              name="hurt"
              required
              defaultValue=""
              className={field}
            >
              <option value="" disabled>
                Choose a player
              </option>
              {teams.map((t) => (
                <optgroup key={t.id} label={t.name}>
                  {people
                    .filter((p) => p.teamSeasonId === t.id)
                    .map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="injury-area">Where they were hurt</label>
            <select
              id="injury-area"
              name="bodyArea"
              required
              defaultValue=""
              className={field}
            >
              <option value="" disabled>
                Choose one
              </option>
              {BODY_AREA_KEYS.map((k) => (
                <option key={k} value={k}>
                  {BODY_AREAS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="injury-care">What care they needed</label>
            <select
              id="injury-care"
              name="care"
              required
              defaultValue=""
              className={field}
            >
              <option value="" disabled>
                Choose one
              </option>
              {CARE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CARE_LEVELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="injury-details">What happened</label>
            <textarea
              id="injury-details"
              name="details"
              required
              rows={5}
              maxLength={INJURY_TEXT_MAX}
              aria-describedby="injury-details-hint"
              className={field}
            />
            <p id="injury-details-hint" className="text-small text-text-muted">
              What you saw: when, how it happened and what was done. Leave out
              anything the league doesn&apos;t need, such as a diagnosis.
            </p>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1">
              Who saw it (optional, up to {WITNESSES_MAX})
            </legend>
            {teams.map((t) => (
              <div key={t.id} className="flex flex-col gap-2">
                <p className="text-small text-text-muted">{t.name}</p>
                {people.filter((p) => p.teamSeasonId === t.id).length === 0 ? (
                  <p className="text-small text-text-muted">
                    No players on this roster.
                  </p>
                ) : (
                  people
                    .filter((p) => p.teamSeasonId === t.id)
                    .map((p) => (
                      <label key={p.userId} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="witnesses"
                          value={p.userId}
                        />
                        {p.name}
                      </label>
                    ))
                )}
              </div>
            ))}
          </fieldset>
          <SubmitButton className="btn self-start btn-primary">
            Send the report
          </SubmitButton>
        </form>
      )}
    </>
  );
}
