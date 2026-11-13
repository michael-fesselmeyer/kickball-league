import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  exportsKeepOffEntries,
  leagueKeepOffs,
  leagueTeams,
} from "@/db/queries/keep-off";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { MANY_ON_ONE_LIST, oversight } from "@/domain/keep-off/keep-off";
import { requirePermission } from "@/lib/auth/permission";
import {
  KEEP_OFF_MESSAGES,
  KeepOffFields,
} from "../../seasons/[season]/team/keep-off";
import {
  addAdminKeepOffAction,
  removeAdminKeepOffAction,
  setExportPolicyAction,
} from "./actions";

export const metadata: Metadata = { title: "Not-on-my-team lists" };

export default function TeamListsPage(
  props: PageProps<"/app/admin/team-lists">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the lists…</p>}>
        <TeamLists {...props} />
      </Suspense>
    </main>
  );
}

const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  ...KEEP_OFF_MESSAGES,
  on_team: {
    ok: false,
    text: "They're on that team's roster this season. Move them first.",
  },
  unknown_team: { ok: false, text: "Pick one of the league's teams." },
  policy_saved: { ok: true, text: "Saved." },
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

async function TeamLists({ searchParams }: PageProps<"/app/admin/team-lists">) {
  const subject = await requirePermission("keep_off.review", {
    next: "/app/admin/team-lists",
  });
  const query = await searchParams;
  const league = await currentLeague(db);
  if (!league) notFound();
  const [entries, teams, inExport] = await Promise.all([
    leagueKeepOffs(db, league.id),
    leagueTeams(db, league.id),
    exportsKeepOffEntries(db),
  ]);
  const summary = oversight(entries);
  const flagged = summary.teams.filter((t) => t.many);
  const message =
    typeof query.notice === "string" ? MESSAGES[query.notice] : undefined;
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: league.timeZone,
    }).format(d);
  const byTeam = summary.teams.map((t) => ({
    ...t,
    entries: entries.filter((e) => e.teamId === t.teamId),
  }));

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Not-on-my-team lists</h1>
        <p className="text-text-muted">
          Each team&apos;s private list of people it won&apos;t take. A person
          on a list can&apos;t join that team by its link, isn&apos;t placed on
          it and doesn&apos;t see its sub requests; nothing else changes for
          them, and they&apos;re never told. Watch for a team listing many
          people, or one person on several lists: that may be a safety problem
          for an incident report, or a list being misused.
        </p>
      </header>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.ok ? "border-success" : "border-danger"}`}
        >
          {message.text}
        </p>
      )}

      <section aria-labelledby="look" className="flex flex-col gap-2">
        <h2 id="look" className="text-h2">
          Worth a look
        </h2>
        {flagged.length === 0 && summary.people.length === 0 ? (
          <p className="text-text-muted">
            No team lists {MANY_ON_ONE_LIST} or more people, and nobody is on
            more than one list.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {flagged.map((t) => (
              <li key={t.teamId}>
                <strong>{t.teamName}</strong> lists {t.count} people.
              </li>
            ))}
            {summary.people.map((p) => (
              <li key={p.userId}>
                <strong>{p.name}</strong> is on {p.teams.length} lists:{" "}
                {p.teams.join(", ")}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lists" className="flex flex-col gap-4">
        <h2 id="lists" className="text-h2">
          Every list ({entries.length})
        </h2>
        {byTeam.length === 0 ? (
          <p className="text-text-muted">No team has anyone on its list.</p>
        ) : (
          byTeam.map((t) => (
            <section
              key={t.teamId}
              aria-labelledby={`team-${t.teamId}`}
              className="flex flex-col"
            >
              <h3 id={`team-${t.teamId}`} className="font-bold">
                {t.teamName} ({t.count})
              </h3>
              <ul className="flex flex-col">
                {t.entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-start justify-between gap-2 border-t border-border py-2"
                  >
                    <span className="flex flex-col">
                      <span>{e.name}</span>
                      <span className="text-small break-all text-text-muted">
                        {e.email} · added {when(e.addedAt)}
                        {e.addedByName ? ` by ${e.addedByName}` : ""}
                      </span>
                      <span className="text-small whitespace-pre-line">
                        {e.reason ?? "No reason given."}
                      </span>
                    </span>
                    <form action={removeAdminKeepOffAction.bind(null, e.id)}>
                      <button
                        type="submit"
                        className="inline-flex min-h-11 items-center underline"
                      >
                        Remove
                        <span className="sr-only">
                          {" "}
                          {e.name} from {t.teamName}&apos;s list
                        </span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>

      <section
        id="add"
        aria-labelledby="add-title"
        className="flex flex-col gap-2"
      >
        <h2 id="add-title" className="text-h2">
          Add someone to a team&apos;s list
        </h2>
        <form action={addAdminKeepOffAction} className="flex flex-col gap-2">
          <label htmlFor="admin-keep-off-team">Team</label>
          <select
            id="admin-keep-off-team"
            name="teamId"
            required
            className={field}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <KeepOffFields idPrefix="admin-keep-off" />
          <button type="submit" className="btn self-start btn-secondary">
            Add to the list
          </button>
        </form>
      </section>

      <section
        id="export"
        aria-labelledby="export-title"
        className="flex flex-col gap-2"
      >
        <h2 id="export-title" className="text-h2">
          A person&apos;s own data export
        </h2>
        <p>
          {inExport
            ? "A person's own data export lists the entries about them: the team, the date and the reason."
            : "A person's own data export leaves out entries about them. Entries a captain added are always in that captain's export."}{" "}
          Whether a data request should include them is the league&apos;s call;
          see the decision record for the trade-offs.
        </p>
        {can(subject, "keep_off.export_policy") ? (
          <form action={setExportPolicyAction.bind(null, !inExport)}>
            <button type="submit" className="btn btn-secondary">
              {inExport
                ? "Leave them out of a person's export"
                : "List them in a person's export"}
            </button>
          </form>
        ) : (
          <p className="text-text-muted">Only an owner can change this.</p>
        )}
      </section>
    </>
  );
}
