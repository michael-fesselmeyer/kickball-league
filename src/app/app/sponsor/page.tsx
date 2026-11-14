import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { managedSponsors } from "@/db/queries/sponsors";
import { can } from "@/domain/authz/permissions";
import {
  SPONSOR_FORM_ERRORS,
  SPONSOR_KIND_LABELS,
  SPONSOR_KINDS,
} from "@/domain/sponsors/sponsor-form";
import { currentSubject } from "@/lib/auth/permission";
import { createSponsorAction } from "./actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Sponsors" };

/**
 * The sponsors a person manages. A sponsor's own people with one sponsor
 * go straight to it; admins see every sponsor and can add one.
 */
export default function SponsorsHome(props: PageProps<"/app/sponsor">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Sponsors {...props} />
      </Suspense>
    </main>
  );
}

const input = "rounded-md border border-border bg-surface px-2 py-1";

const NOTICES: Record<string, string> = {
  removed: "Sponsor taken off the site. Their past numbers are kept.",
};

const ERRORS: Record<string, string> = {
  ...SPONSOR_FORM_ERRORS,
  slug_taken: "Another sponsor already uses that page address.",
  no_league: "Set up the league first.",
};

async function Sponsors({ searchParams }: PageProps<"/app/sponsor">) {
  const subject = await currentSubject();
  if (subject.userId === null) redirect("/sign-in?next=/app/sponsor");
  const isAdmin = can(subject, "sponsor.edit", {});
  if (!isAdmin && subject.sponsorIds.length === 0) notFound();
  const league = await currentLeague(db);
  const sponsors = league
    ? await managedSponsors(db, league.id, isAdmin ? "all" : subject.sponsorIds)
    : [];
  const [only] = sponsors;
  if (!isAdmin && sponsors.length === 1 && only)
    redirect(`/app/sponsor/${only.slug}`);
  const query = await searchParams;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Sponsors</h1>
        <p className="text-text-muted">
          Deals, the check-in code and weekly numbers for each sponsor.
          {isAdmin && (
            <> Name the team of the week from a season&apos;s admin page.</>
          )}
        </p>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {sponsors.length === 0 ? (
        <p className="text-text-muted">No sponsors yet.</p>
      ) : (
        <ul className="flex flex-col">
          {sponsors.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3"
            >
              <Link
                href={`/app/sponsor/${s.slug}`}
                className="inline-flex min-h-6 items-center font-bold underline"
              >
                {s.name}
              </Link>
              {s.isHomeBar && <span className="sticker">Home bar</span>}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <section aria-labelledby="add" className="flex flex-col gap-3">
          <h2 id="add" className="text-h2">
            Add a sponsor
          </h2>
          <form action={createSponsorAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              Name
              <input name="name" required maxLength={80} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Page address (optional, made from the name)
              <input
                name="slug"
                maxLength={60}
                className={`${input} font-mono`}
              />
            </label>
            <label className="flex flex-col gap-1">
              Kind
              <select
                name="kind"
                defaultValue="bar"
                className={`${input} self-start`}
              >
                {SPONSOR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SPONSOR_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-6 items-center gap-2">
              <input type="checkbox" name="homeBar" />
              The league&apos;s home bar (takes over from any other)
            </label>
            <label className="flex flex-col gap-1">
              A line or two for players (optional)
              <textarea
                name="blurb"
                maxLength={500}
                rows={2}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              Address (optional)
              <input name="address" maxLength={200} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Website (optional)
              <input
                name="url"
                type="text"
                inputMode="url"
                placeholder="https://"
                className={input}
              />
            </label>
            <button type="submit" className="btn self-start btn-primary">
              Add sponsor
            </button>
          </form>
        </section>
      )}
    </>
  );
}
