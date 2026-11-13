import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { matcherInput, type PoolEntry } from "@/db/queries/free-agents";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { formatFriendCode } from "@/domain/matcher/friend-code";
import { suggestNewTeam, suggestPlacements } from "@/domain/matcher/matcher";
import { labelOf } from "@/domain/matcher/quiz";
import { requirePermission } from "@/lib/auth/permission";
import {
  applyAllAction,
  applySuggestionAction,
  buildTeamAction,
} from "./actions";

export const metadata: Metadata = { title: "Free-agent matcher" };

const ERRORS: Record<string, string> = {
  unknown_registration:
    "Someone in that suggestion is no longer in the pool. The suggestions below are up to date.",
  already_on_team:
    "Someone in that suggestion is already on a team. The suggestions below are up to date.",
  unknown_team: "That team is no longer open for this season.",
  full: "That team has no room for everyone in the suggestion.",
  splits_group:
    "That would split up a friend group. Pick everyone in the group together.",
  nothing_to_apply: "There are no suggestions to apply.",
  nobody_picked: "Pick the players for the new team.",
  no_captain: "Pick a captain from the players on the new team.",
  bad_name: "Give the team a name of up to 40 characters.",
  name_taken: "A team in this league already has that name.",
  bad_color: "Pick a team color.",
  too_many: "That's more players than the season's roster limit.",
};

const SIDE: Record<string, string> = { woman: "W", man: "M" };

export default function FreeAgentsPage(
  props: PageProps<"/app/admin/seasons/[season]/free-agents">,
) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <FreeAgents {...props} />
      </Suspense>
    </main>
  );
}

function Swatch({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border border-border"
      style={{ background: color }}
    />
  );
}

function counts(c: { players: number; women: number; men: number }) {
  return `${c.players} (${c.women} W · ${c.men} M)`;
}

function quizCells(p: PoolEntry) {
  const a = p.answers;
  return (
    <>
      <td>{a ? labelOf("experience", a.experience) : "No quiz yet"}</td>
      <td>
        {a
          ? a.positions.length === 0
            ? "Anywhere"
            : a.positions.map((x) => labelOf("positions", x)).join(", ")
          : ""}
      </td>
      <td>{a ? labelOf("availability", a.availability) : ""}</td>
      <td>{a ? labelOf("vibe", a.vibe) : ""}</td>
      <td>
        {a?.captain === "yes"
          ? "Will captain"
          : a?.captain === "help"
            ? "Will help"
            : ""}
      </td>
    </>
  );
}

async function FreeAgents({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/free-agents">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("free_agents.place", {
    next: `/app/admin/seasons/${slug}/free-agents`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const input = await matcherInput(db, season.id);
  if (!input) notFound();
  const { pool, teams } = input;
  const result = suggestPlacements(pool, teams);
  const left = new Set(result.unplaced.flatMap((u) => u.registrationIds));
  const newTeam = suggestNewTeam(
    pool.filter((p) => left.has(p.registrationId)),
    input.rosterMax,
  );
  const prechecked = new Set(newTeam.registrationIds);
  const teamById = new Map<string, (typeof teams)[number]>(
    teams.map((t) => [t.teamSeasonId, t]),
  );
  const groups = new Set(pool.flatMap((p) => p.groupId ?? [])).size;
  const answered = pool.filter((p) => p.answers).length;

  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    query.notice === "applied"
      ? "Suggestion applied. They're on the team."
      : query.notice === "applied_all"
        ? `Applied ${typeof query.count === "string" ? query.count : "all"} suggestions.`
        : query.notice === "team_built"
          ? "New team created in forming status, with its captain and players."
          : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Free-agent matcher</h1>
        <p className="text-text-muted">
          {pool.length} {pool.length === 1 ? "free agent" : "free agents"} ·{" "}
          {answered} took the quiz · {groups}{" "}
          {groups === 1 ? "friend group" : "friend groups"}
        </p>
        <p className="max-w-prose">
          Suggestions keep friend groups together, stay within each team&apos;s
          roster size, and even out women and men for the fielding rule first.
          Then they look at game-day turnout, vibe, experience and positions.
          Nothing changes until you apply a suggestion.
        </p>
        <Link
          href={`/app/admin/seasons/${slug}/registrations`}
          className="underline"
        >
          Place someone by hand on the registrations page
        </Link>
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

      <section aria-labelledby="suggestions" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="suggestions" className="text-h2">
            Suggestions
          </h2>
          {result.suggestions.length > 1 && (
            <form action={applyAllAction.bind(null, slug)}>
              <button type="submit" className="btn btn-primary">
                Apply all {result.suggestions.length}
              </button>
            </form>
          )}
        </div>
        {result.suggestions.length === 0 ? (
          <p className="text-text-muted">
            {pool.length === 0
              ? "Nobody in the pool."
              : teams.length === 0
                ? "No teams yet. Build one from the pool below."
                : "No team has room for anyone left in the pool."}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {result.suggestions.map((s) => (
              <li
                key={s.registrationIds.join()}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span>{s.names.join(", ")}</span>
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">to</span>
                  <Swatch
                    color={teamById.get(s.teamSeasonId)?.colorHex ?? null}
                  />
                  <span>{s.teamName}</span>
                </p>
                <ul className="list-disc pl-5 text-text-muted">
                  {s.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <form
                  action={applySuggestionAction.bind(
                    null,
                    slug,
                    s.teamSeasonId,
                    s.registrationIds,
                  )}
                >
                  <button
                    type="submit"
                    className="btn btn-secondary"
                    aria-label={`Apply: ${s.names.join(", ")} to ${s.teamName}`}
                  >
                    Apply
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {result.unplaced.length > 0 && (
          <>
            <h3 className="text-h3">Not placed yet</h3>
            <ul className="flex flex-col gap-2">
              {result.unplaced.map((u) => (
                <li key={u.registrationIds.join()}>
                  <strong>{u.names.join(", ")}</strong>: {u.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {teams.length > 0 && (
        <section aria-labelledby="teams" className="flex flex-col gap-3">
          <h2 id="teams" className="text-h2">
            Teams after these suggestions
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Roster size</th>
                  <th scope="col">Now</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {result.teams.map((t) => (
                  <tr key={t.teamSeasonId} className="border-t border-border">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <Swatch
                          color={teamById.get(t.teamSeasonId)?.colorHex ?? null}
                        />
                        {t.name}
                      </span>
                    </td>
                    <td>{t.capacity}</td>
                    <td>{counts(t.before)}</td>
                    <td>{counts(t.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-small text-text-muted">
            W and M count players by the fielding group in their profile.
          </p>
        </section>
      )}

      <section aria-labelledby="pool" className="flex flex-col gap-3">
        <h2 id="pool" className="text-h2">
          The pool
        </h2>
        {pool.length === 0 ? (
          <p className="text-text-muted">Nobody in the pool.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Group</th>
                  <th scope="col">
                    <abbr title="Fielding group">Field</abbr>
                  </th>
                  <th scope="col">Played</th>
                  <th scope="col">Positions</th>
                  <th scope="col">Nights</th>
                  <th scope="col">Here for</th>
                  <th scope="col">Captain</th>
                </tr>
              </thead>
              <tbody>
                {pool.map((p) => (
                  <tr
                    key={p.registrationId}
                    className="border-t border-border align-top"
                  >
                    <td className="py-2">
                      {p.name}
                      {p.notes && (
                        <span className="block text-small text-text-muted">
                          “{p.notes}”
                        </span>
                      )}
                    </td>
                    <td className="font-mono">
                      {p.code ? formatFriendCode(p.code) : ""}
                    </td>
                    <td>{p.side ? SIDE[p.side] : "–"}</td>
                    {quizCells(p)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pool.length > 0 && (
        <section
          id="new-team"
          aria-labelledby="new-team-title"
          className="flex flex-col gap-4 rounded-lg border border-border p-4"
        >
          <h2 id="new-team-title" className="text-h2">
            Build a new team from the pool
          </h2>
          <p className="max-w-prose text-text-muted">
            The team starts as forming. Its players keep their free-agent
            registration and fee, and the captain can invite more players.
            {prechecked.size > 0
              ? " The players who don't fit an existing team are picked to start."
              : " Everyone fits an existing team right now, but you can still pick players for a new one."}
          </p>
          {prechecked.size > 0 && (
            <ul className="list-disc pl-5 text-text-muted">
              {newTeam.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <form
            action={buildTeamAction.bind(null, slug)}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col gap-1">
                Team name
                <input
                  name="name"
                  required
                  maxLength={40}
                  className="min-h-11 rounded-lg border border-border px-3"
                />
              </label>
              <label className="flex flex-col gap-1">
                Color
                <input
                  name="colorHex"
                  type="color"
                  defaultValue="#e4572e"
                  className="min-h-11 w-20 rounded-lg border border-border"
                />
              </label>
              <label className="flex flex-col gap-1">
                Captain
                <select
                  name="captainId"
                  required
                  defaultValue={newTeam.captainId ?? ""}
                  className="min-h-11 rounded-lg border border-border px-3"
                >
                  <option value="" disabled>
                    Pick a captain
                  </option>
                  {pool.map((p) => (
                    <option key={p.registrationId} value={p.registrationId}>
                      {p.name}
                      {p.captain === "yes"
                        ? " (will captain)"
                        : p.captain === "help"
                          ? " (will help)"
                          : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">
                Players (up to {input.rosterMax}, captain included)
              </legend>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {pool.map((p) => (
                  <label
                    key={p.registrationId}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      name="registrationId"
                      value={p.registrationId}
                      defaultChecked={prechecked.has(p.registrationId)}
                      className="size-5"
                    />
                    <span>
                      {p.name}{" "}
                      <span className="text-text-muted">
                        {[
                          p.side ? SIDE[p.side] : null,
                          p.code ? `group ${formatFriendCode(p.code)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" className="btn self-start btn-primary">
              Create the team
            </button>
          </form>
        </section>
      )}
    </>
  );
}
