import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { db } from "@/db/client";
import { gamePeople } from "@/db/queries/discipline";
import { gameForScoring } from "@/db/queries/scores";
import {
  canFileFor,
  DETAILS_MAX,
  INCIDENT_KIND_KEYS,
  INCIDENT_KINDS,
} from "@/domain/discipline/discipline";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import { PARK_RULES } from "@/domain/concerns/concerns";
import { fileIncidentAction } from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Report an incident" };

export default function IncidentPage(
  props: PageProps<"/[lang]/app/games/[game]/incident">,
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
  bad_kind: "Choose what kind of incident it was.",
  bad_park_rule: "Choose one of the park rules, or leave it blank.",
  no_details: "Say what happened.",
  details_too_long: `Keep it under ${DETAILS_MAX} characters.`,
  unknown_person: "Pick people from the two teams in this game.",
  not_started: "This game hasn't started yet.",
  called_off: "This game was called off.",
  not_found: "That game is gone.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

async function Report({
  params,
  searchParams,
}: PageProps<"/[lang]/app/games/[game]/incident">) {
  await requireFeature("discipline");
  const { game: rawId } = await params;
  const query = await searchParams;
  const gameId = parseId<GameId>(rawId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  await requirePermission("incident.log", {
    next: `/app/games/${rawId}/incident`,
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
        <Link href={`/app/games/${g.id}/score`} className="underline">
          {g.teamAName} vs {g.teamBName}
        </Link>
        <h1 className="text-h1">Report an incident</h1>
        <HelpLink
          audience="ref"
          article="incidents"
          topic="reporting an incident"
        />
        <p className="text-text-muted">
          Only league admins read reports. They follow up, and decide on any
          suspension.
        </p>
        <p>
          <Link
            href={`/app/games/${g.id}/incident/injury`}
            className="inline-flex min-h-11 items-center underline"
          >
            Someone was hurt? Report an injury
          </Link>
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.filed ? (
        <p role="status" className="rounded-lg border border-success p-3">
          Report sent. The league&apos;s admins will review it.
        </p>
      ) : !open.ok ? (
        <p>{ERRORS[open.error]}</p>
      ) : (
        <form
          action={fileIncidentAction.bind(null, g.id)}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="incident-kind">What kind of incident</label>
            <select
              id="incident-kind"
              name="kind"
              required
              defaultValue=""
              className={field}
            >
              <option value="" disabled>
                Choose one
              </option>
              {INCIDENT_KIND_KEYS.filter((k) => k !== "injury").map((k) => (
                <option key={k} value={k}>
                  {INCIDENT_KINDS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="incident-park-rule">
              If it is about how the park is used, which rule (optional)
            </label>
            <select
              id="incident-park-rule"
              name="parkRule"
              defaultValue={
                typeof query.parkRule === "string" &&
                Object.hasOwn(PARK_RULES, query.parkRule)
                  ? query.parkRule
                  : ""
              }
              className={field}
            >
              <option value="">Not about the park</option>
              {Object.entries(PARK_RULES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {teams.map((t) => {
            const players = people.filter((p) => p.teamSeasonId === t.id);
            return (
              <fieldset key={t.id} className="flex flex-col gap-2">
                <legend className="mb-1">People involved from {t.name}</legend>
                {players.length === 0 ? (
                  <p className="text-small text-text-muted">
                    No players on this roster.
                  </p>
                ) : (
                  players.map((p) => (
                    <label key={p.userId} className="check-row">
                      <input type="checkbox" name="people" value={p.userId} />
                      {p.name}
                    </label>
                  ))
                )}
              </fieldset>
            );
          })}
          <div className="flex flex-col gap-1">
            <label htmlFor="incident-details">What happened</label>
            <textarea
              id="incident-details"
              name="details"
              required
              rows={6}
              maxLength={DETAILS_MAX}
              aria-describedby="incident-details-hint"
              className={field}
            />
            <p
              id="incident-details-hint"
              className="text-small text-text-muted"
            >
              Stick to what you saw: when, who and what was said or done.
            </p>
          </div>
          <SubmitButton className="btn self-start btn-primary">
            Send the report
          </SubmitButton>
        </form>
      )}
    </>
  );
}
