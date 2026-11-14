import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { divisionsScreen } from "@/db/queries/divisions";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import {
  MAX_CROSSOVER_GAMES,
  MAX_DIVISION_NAME,
  ruleSetSummary,
} from "@/domain/season/divisions";
import { requirePermission } from "@/lib/auth/permission";
import {
  assignTeamsAction,
  createDivisionAction,
  createRuleSetAction,
  deleteDivisionAction,
  saveSettingsAction,
  updateDivisionAction,
} from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Divisions" };

export default function DivisionsPage(
  props: PageProps<"/app/admin/seasons/[season]/divisions">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Divisions {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  invalid_name: `Give the division a name of up to ${MAX_DIVISION_NAME} characters, with at least one letter or digit.`,
  duplicate: "The season already has a division with that name.",
  unknown_rule_set: "Pick one of the league's rule sets, or none.",
  unknown_division: "That division is gone. It may have just been removed.",
  in_bracket:
    "A playoff bracket crowns that division, so it stays for this season.",
  unknown_team: "A team in the list has left the season. Reload and try again.",
  invalid_crossovers: `Crossover games are a whole number from 0 to ${MAX_CROSSOVER_GAMES}.`,
  unknown_season: "That season is gone.",
  rule_invalid_name: "Give the rule set a name.",
  rule_invalid_limits:
    "Innings are 1 to 15 and the time limit 10 to 240 minutes, or leave them empty.",
  rule_duplicate: "The league already has a rule set with that name.",
};

const NOTICES: Record<string, (q: Record<string, string>) => string> = {
  division_added: () => "Division added. Put teams in it below.",
  division_saved: () => "Division saved.",
  division_removed: () => "Division removed. Its teams have no division now.",
  teams_saved: (q) =>
    `${q.count === "1" ? "1 team" : `${q.count ?? 0} teams`} moved. Generate the schedule again to use the new divisions.`,
  settings_saved: () =>
    "Saved. Generate the schedule again to change crossover games.",
  rule_set_added: () => "Rule set added. Pick it for a division above.",
};

const input =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3";

async function Divisions({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/divisions">) {
  const { season: slug } = await params;
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  const page = `/app/admin/seasons/${slug}/divisions`;
  await requirePermission("season.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const screen = await divisionsScreen(db, season.leagueId, season.id);
  const { divisions, ruleSets, teams, settings } = screen;
  const error = query.error ? ERRORS[query.error] : undefined;
  const notice = query.notice ? NOTICES[query.notice]?.(query) : undefined;
  const unassigned =
    divisions.length > 0 ? teams.filter((t) => t.divisionId === null) : [];
  const ruleSetOptions = (
    <>
      <option value="">No rule set</option>
      {ruleSets.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </>
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Divisions</h1>
        <p className="max-w-prose text-text-muted">
          Split the season into divisions, such as Competitive and Social. Each
          plays its own round robin and has its own standings, plus any
          crossover games against the other division. A season with no divisions
          plays as one pool.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}

      <section aria-labelledby="divisions" className="flex flex-col gap-4">
        <h2 id="divisions" className="text-h2">
          Divisions
        </h2>
        {divisions.length === 0 ? (
          <p className="text-text-muted">
            No divisions: every team plays in one pool.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {divisions.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-3 rounded-card border border-border p-4"
              >
                <form
                  action={updateDivisionAction.bind(null, slug, d.id)}
                  className="flex flex-wrap items-end gap-3"
                >
                  <label className="flex flex-col gap-1">
                    Name
                    <input
                      name="name"
                      required
                      maxLength={MAX_DIVISION_NAME}
                      defaultValue={d.name}
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Rule set
                    <select
                      name="ruleSetId"
                      defaultValue={d.ruleSet?.id ?? ""}
                      className={input}
                    >
                      {ruleSetOptions}
                    </select>
                  </label>
                  <SubmitButton className="btn btn-secondary">
                    Save {d.name}
                  </SubmitButton>
                </form>
                <p className="text-small text-text-muted">
                  {teams.filter((t) => t.divisionId === d.id).length} teams
                  {d.ruleSet && (
                    <>
                      {" · "}
                      {d.ruleSet.name}
                      {ruleSetSummary(d.ruleSet) &&
                        `: ${ruleSetSummary(d.ruleSet)}`}
                    </>
                  )}
                </p>
                <form action={deleteDivisionAction.bind(null, slug, d.id)}>
                  <SubmitButton className="btn btn-secondary">
                    Remove {d.name}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form
          action={createDivisionAction.bind(null, slug)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            New division
            <input
              name="name"
              required
              maxLength={MAX_DIVISION_NAME}
              placeholder="Social"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Its rule set
            <select name="ruleSetId" defaultValue="" className={input}>
              {ruleSetOptions}
            </select>
          </label>
          <SubmitButton className="btn btn-primary">Add division</SubmitButton>
        </form>
      </section>

      {divisions.length > 0 && (
        <section aria-labelledby="teams" className="flex flex-col gap-4">
          <h2 id="teams" className="text-h2">
            Teams
          </h2>
          {unassigned.length > 0 && (
            <p className="rounded-lg border border-warning p-3">
              {unassigned.length === 1
                ? "1 team has no division."
                : `${unassigned.length} teams have no division.`}{" "}
              The scheduler plays them as a pool of their own and they get a
              standings table of their own, so put every team in a division
              before you generate the schedule.
            </p>
          )}
          {teams.length === 0 ? (
            <p className="text-text-muted">No teams have entered yet.</p>
          ) : (
            <form
              action={assignTeamsAction.bind(null, slug)}
              className="flex flex-col gap-3"
            >
              <ul className="flex flex-col gap-2">
                {teams.map((t) => (
                  <li key={t.id}>
                    <label className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        {t.name}
                        {t.status !== "confirmed" && (
                          <span className="text-text-muted">
                            {" "}
                            ({t.status.replace("_", " ")})
                          </span>
                        )}
                      </span>
                      <select
                        name={`team-${t.id}`}
                        defaultValue={t.divisionId ?? ""}
                        className={input}
                      >
                        <option value="">No division</option>
                        {divisions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
              <SubmitButton className="btn self-start btn-primary">
                Save teams
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      <section aria-labelledby="settings" className="flex flex-col gap-4">
        <h2 id="settings" className="text-h2">
          Crossover games and playoffs
        </h2>
        <form
          action={saveSettingsAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 self-start">
            Crossover games per team
            <input
              name="crossoverGames"
              type="number"
              min={0}
              max={MAX_CROSSOVER_GAMES}
              defaultValue={settings.crossoverGames}
              className={`${input} w-24`}
            />
          </label>
          <p className="max-w-prose text-small text-text-muted">
            Games against the other division, on top of the round robin and
            spread through the season. They need exactly two divisions. When the
            divisions differ in size, every team in the smaller one plays this
            many and the larger division&apos;s teams share the rest evenly.
          </p>
          <label className="flex min-h-11 items-center gap-2">
            <input
              name="crossoversCount"
              type="checkbox"
              defaultChecked={settings.crossoversCount}
              className="size-5"
            />
            Crossover results count in division standings
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              name="combinedFinal"
              type="checkbox"
              defaultChecked={settings.combinedFinal}
              className="size-5"
            />
            The two division champions meet in a combined final
          </label>
          <p className="max-w-prose text-small text-text-muted">
            With a combined final, each division fills one half of a single
            bracket. Without one, each division gets its own bracket and
            champion.
          </p>
          <SubmitButton className="btn self-start btn-primary">
            Save settings
          </SubmitButton>
        </form>
      </section>

      <section aria-labelledby="rule-sets" className="flex flex-col gap-4">
        <h2 id="rule-sets" className="text-h2">
          Rule sets
        </h2>
        {ruleSets.length === 0 ? (
          <p className="text-text-muted">
            No rule sets yet. Divisions without one play the league&apos;s usual
            rules.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {ruleSets.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>
                {ruleSetSummary(r) && (
                  <span className="text-text-muted">
                    {" "}
                    · {ruleSetSummary(r)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          action={createRuleSetAction.bind(null, slug)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            Rule set name
            <input
              name="name"
              required
              maxLength={MAX_DIVISION_NAME}
              placeholder="Competitive"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Innings
            <input
              name="innings"
              type="number"
              min={1}
              max={15}
              className={`${input} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1">
            Time limit (minutes)
            <input
              name="timeLimitMinutes"
              type="number"
              min={10}
              max={240}
              className={`${input} w-28`}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input name="bunting" type="checkbox" className="size-5" />
            Bunting
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input name="stealing" type="checkbox" className="size-5" />
            Stealing
          </label>
          <SubmitButton className="btn btn-secondary">
            Add rule set
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
