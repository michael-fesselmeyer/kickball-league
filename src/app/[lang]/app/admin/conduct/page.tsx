import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import {
  conductVersions,
  currentConductCode,
  teamAcceptance,
} from "@/db/queries/conduct";
import { season } from "@/db/schema/season";
import {
  DEFAULT_CONDUCT_BODY,
  DEFAULT_CONDUCT_TITLE,
} from "@/domain/conduct/conduct";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { ConductDraftForm } from "./draft-form";

export const metadata: Metadata = { title: "Code of conduct" };

export default function ConductPage(
  props: PageProps<"/[lang]/app/admin/conduct">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Conduct {...props} />
      </Suspense>
    </main>
  );
}

const day = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(d);

async function Conduct({
  searchParams,
}: PageProps<"/[lang]/app/admin/conduct">) {
  await requirePermission("season.manage", { next: "/app/admin/conduct" });
  const query = await searchParams;
  const league = await activeLeague();
  if (!league) notFound();
  const [versions, current, seasons] = await Promise.all([
    conductVersions(db, league.id),
    currentConductCode(db, league.id),
    db
      .select({ id: season.id, slug: season.slug, name: season.name })
      .from(season)
      .where(eq(season.leagueId, league.id))
      .orderBy(desc(season.startsOn)),
  ]);
  const chosen =
    seasons.find((s) => s.slug === query.season) ?? seasons[0] ?? null;
  const roster = chosen
    ? await teamAcceptance(db, league.id, chosen.id)
    : { code: null, teams: [] };

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/seasons" className="underline">
          All seasons
        </Link>
        <h1 className="text-h1">Code of conduct</h1>
        <p className="text-text-muted">
          Players accept the current version when they register, join a team or
          join as a free agent, and again only when you publish a new one. It
          shows on the public rules page. Each acceptance keeps the version and
          time.
        </p>
      </header>
      {query.published && (
        <p role="status" className="rounded-lg border border-success p-3">
          Version {String(query.published)} published. Players accept it at
          their next registration.
        </p>
      )}

      <section aria-labelledby="who" className="flex flex-col gap-3">
        <h2 id="who" className="text-h2">
          Who has accepted
        </h2>
        {!current ? (
          <p className="text-text-muted">
            No code is published yet, so nobody is asked.
          </p>
        ) : seasons.length === 0 ? (
          <p className="text-text-muted">No seasons yet.</p>
        ) : (
          <>
            <p className="text-text-muted">
              Version {current.version} of the code, for each team in{" "}
              {chosen?.name}. A player is asked at registration, so someone who
              signed up before this version was published shows as not yet.
            </p>
            <nav aria-label="Seasons" className="flex flex-wrap gap-3">
              {seasons.map((s) => (
                <Link
                  key={s.id}
                  href={`/app/admin/conduct?season=${s.slug}`}
                  aria-current={s.id === chosen?.id ? "page" : undefined}
                  className="underline aria-[current=page]:font-bold"
                >
                  {s.name}
                </Link>
              ))}
            </nav>
            {roster.teams.length === 0 ? (
              <p className="text-text-muted">No players on teams yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {roster.teams.map((t) => {
                  const done = t.players.filter((p) => p.accepted).length;
                  return (
                    <li key={t.teamSeasonId}>
                      <details className="rounded-lg border border-border p-3">
                        <summary>
                          <strong>{t.teamName}</strong>: {done} of{" "}
                          {t.players.length} accepted
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1">
                          {t.players.map((p) => (
                            <li key={p.userId}>
                              {p.name}:{" "}
                              <span
                                className={
                                  p.accepted
                                    ? "text-success"
                                    : "text-text-muted"
                                }
                              >
                                {p.accepted ? "Accepted" : "Not yet"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="versions" className="flex flex-col gap-3">
        <h2 id="versions" className="text-h2">
          Versions
        </h2>
        {versions.length === 0 ? (
          <p className="text-text-muted">Nothing published yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {versions.map((v) => (
              <li key={v.id}>
                <strong>Version {v.version}</strong>: {v.title}{" "}
                <span className="text-text-muted">
                  · {day(v.createdAt, league.timeZone)} · {v.accepted} accepted
                  · fingerprint <code>{v.bodySha256.slice(0, 12)}</code>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new" className="flex flex-col gap-3">
        <h2 id="new" className="text-h2">
          {current ? "Publish a new version" : "Write the code"}
        </h2>
        {!current && (
          <p className="text-text-muted">
            This starts from sections most leagues need: play, sharing the park,
            alcohol, glass and sound, leaving no trace, and conduct online. Edit
            it to match your league, then publish.
          </p>
        )}
        <ConductDraftForm
          title={current?.title ?? DEFAULT_CONDUCT_TITLE}
          body={current?.bodyMd ?? DEFAULT_CONDUCT_BODY}
        />
      </section>
    </>
  );
}
