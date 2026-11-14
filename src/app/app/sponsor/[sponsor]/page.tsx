import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  sponsorBySlug,
  sponsorDeals,
  sponsorMembers,
} from "@/db/queries/sponsors";
import { can } from "@/domain/authz/permissions";
import { DEAL_FORM_ERRORS, dealWhen } from "@/domain/sponsors/deals";
import {
  SPONSOR_FORM_ERRORS,
  SPONSOR_KIND_LABELS,
  SPONSOR_KINDS,
} from "@/domain/sponsors/sponsor-form";
import { requirePermission } from "@/lib/auth/permission";
import {
  addMemberAction,
  confirmDealsAction,
  removeMemberAction,
  removeSponsorAction,
  saveDealAction,
  setDealActiveAction,
  updateSponsorAction,
} from "../actions";
import { DealFields } from "./deal-fields";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Sponsor page" };

type Props = PageProps<"/app/sponsor/[sponsor]">;

/** A sponsor's portal: its deals, its details and, for admins, its people. */
export default function SponsorPortalPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Portal {...props} />
      </Suspense>
    </main>
  );
}

const input = "rounded-md border border-border bg-surface px-2 py-1";

const NOTICES: Record<string, string> = {
  created: "Sponsor added. Add their deals below.",
  saved: "Details saved. The public page shows them now.",
  deal_saved: "Deal saved and marked as current.",
  deal_on: "Deal turned back on.",
  deal_off: "Deal turned off. Players no longer see it.",
  confirmed: "Every deal is marked as current as of today.",
  member_added: "Added. They'll see this page when they sign in.",
  member_removed: "Removed from this sponsor's page.",
};

const ERRORS: Record<string, string> = {
  ...SPONSOR_FORM_ERRORS,
  ...DEAL_FORM_ERRORS,
  slug_taken: "Another sponsor already uses that page address.",
  not_found: "That sponsor is gone.",
  no_account:
    "Nobody has an account with that email. Ask them to sign in once first.",
  already_member: "They can already manage this page.",
};

async function Portal({ params, searchParams }: Props) {
  const { sponsor: slug } = await params;
  const query = await searchParams;
  const page = `/app/sponsor/${slug}`;
  const sponsor = await sponsorBySlug(db, slug);
  if (!sponsor) notFound();
  const subject = await requirePermission("sponsor.edit", {
    next: page,
    sponsorId: sponsor.id,
  });
  const isAdmin = can(subject, "sponsor.edit", {});
  const [deals, members, league] = await Promise.all([
    sponsorDeals(db, sponsor.id),
    isAdmin ? sponsorMembers(db, sponsor.id) : Promise.resolve([]),
    currentLeague(db),
  ]);
  const timeZone = league?.timeZone ?? "America/New_York";
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  });
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const active = deals.filter((d) => d.active);
  const oldest = active
    .map((d) => d.confirmedAt)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <>
      <header className="flex flex-col gap-3">
        <Link href="/app/sponsor" className="self-start underline">
          Your sponsors
        </Link>
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          {sponsor.isHomeBar ? "Home bar" : SPONSOR_KIND_LABELS[sponsor.kind]}
        </p>
        <h1 className="text-h1">{sponsor.name}</h1>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={`${page}/code`} className="btn btn-primary">
              Show the check-in code
            </Link>
          </li>
          <li>
            <Link href={`${page}/report`} className="btn btn-secondary">
              Weekly numbers
            </Link>
          </li>
          <li>
            <Link href={`/sponsors/${slug}`} className="btn btn-secondary">
              Public page
            </Link>
          </li>
        </ul>
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

      <section aria-labelledby="deals" className="flex flex-col gap-4">
        <h2 id="deals" className="text-h2">
          Deals
        </h2>
        {active.length > 0 && (
          <form
            action={confirmDealsAction.bind(null, slug)}
            className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-2 p-3"
          >
            <p className="flex-1">
              Players see when you last confirmed your deals
              {oldest && <> (oldest: {day.format(oldest)})</>}. Same as last
              week?
            </p>
            <SubmitButton className="btn btn-secondary">
              Yes, all still current
            </SubmitButton>
          </form>
        )}
        {deals.length === 0 && (
          <p className="text-text-muted">
            No deals yet. A food or soft-drink deal works for everyone.
          </p>
        )}
        <ul className="flex flex-col gap-4">
          {deals.map((d) => (
            <li
              key={d.id}
              id={`deal-${d.id}`}
              className="flex flex-col gap-2 rounded-card border border-border p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold">{d.title}</h3>
                <span className="text-small text-text-muted">
                  {d.active
                    ? `On · confirmed ${day.format(d.confirmedAt)}`
                    : "Off"}
                </span>
              </div>
              <p className="text-small">{dealWhen(d)}</p>
              {d.terms && (
                <p className="text-small text-text-muted">{d.terms}</p>
              )}
              <details>
                <summary className="inline-flex min-h-6 cursor-pointer items-center underline">
                  Change this deal
                </summary>
                <form
                  action={saveDealAction.bind(null, slug, d.id)}
                  className="mt-3 flex flex-col gap-3"
                >
                  <DealFields idPrefix={`deal-${d.id}`} values={d} />
                  <SubmitButton className="btn self-start btn-primary">
                    Save deal
                  </SubmitButton>
                </form>
              </details>
              <form
                action={setDealActiveAction.bind(null, slug, d.id, !d.active)}
              >
                <SubmitButton className="inline-flex min-h-6 items-center underline">
                  {d.active ? "Turn off" : "Turn back on"}
                  <span className="sr-only">: {d.title}</span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
        <details
          id="new-deal"
          className="rounded-card border border-border p-4"
        >
          <summary className="inline-flex min-h-6 cursor-pointer items-center font-bold">
            Add a deal
          </summary>
          <form
            action={saveDealAction.bind(null, slug, null)}
            className="mt-3 flex flex-col gap-3"
          >
            <DealFields idPrefix="new" />
            <SubmitButton className="btn self-start btn-primary">
              Add deal
            </SubmitButton>
          </form>
        </details>
      </section>

      <section aria-labelledby="details" className="flex flex-col gap-4">
        <h2 id="details" className="text-h2">
          Details
        </h2>
        <form
          action={updateSponsorAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1">
            Name
            <input
              name="name"
              autoComplete="off"
              required
              maxLength={80}
              defaultValue={sponsor.name}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            A line or two for players (optional)
            <textarea
              name="blurb"
              maxLength={500}
              rows={3}
              defaultValue={sponsor.blurb ?? ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Address (optional)
            <input
              name="address"
              maxLength={200}
              autoComplete="street-address"
              defaultValue={sponsor.address ?? ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Website (optional)
            <input
              name="url"
              type="text"
              inputMode="url"
              defaultValue={sponsor.url ?? ""}
              placeholder="https://"
              className={input}
            />
          </label>
          {isAdmin && (
            <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
              <legend className="px-1">Admins only</legend>
              <label className="flex flex-col gap-1">
                Page address
                <span className="text-small text-text-muted">
                  /sponsors/<span className="font-mono">…</span>
                </span>
                <input
                  name="slug"
                  required
                  maxLength={60}
                  defaultValue={sponsor.slug}
                  className={`${input} font-mono`}
                />
              </label>
              <label className="flex flex-col gap-1">
                Kind
                <select
                  name="kind"
                  defaultValue={sponsor.kind}
                  className={`${input} self-start`}
                >
                  {SPONSOR_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SPONSOR_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="homeBarShown" value="1" />
              <label className="flex min-h-6 items-center gap-2">
                <input
                  type="checkbox"
                  name="homeBar"
                  defaultChecked={sponsor.isHomeBar}
                />
                The league&apos;s home bar (takes over from any other)
              </label>
            </fieldset>
          )}
          <SubmitButton className="btn self-start btn-primary">
            Save details
          </SubmitButton>
        </form>
      </section>

      {isAdmin && (
        <section aria-labelledby="people" className="flex flex-col gap-4">
          <h2 id="people" className="text-h2">
            Who manages this page
          </h2>
          {members.length === 0 ? (
            <p className="text-text-muted">
              Only admins so far. Add someone from {sponsor.name} so they can
              update deals and see their numbers.
            </p>
          ) : (
            <ul className="flex flex-col">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                >
                  <span>
                    {m.name}
                    <span className="block text-small text-text-muted">
                      {m.email}
                    </span>
                  </span>
                  <form action={removeMemberAction.bind(null, slug, m.userId)}>
                    <SubmitButton className="inline-flex min-h-6 items-center underline">
                      Remove<span className="sr-only">: {m.name}</span>
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form
            action={addMemberAction.bind(null, slug)}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              Their account email
              <input
                name="email"
                type="email"
                required
                autoComplete="off"
                className={input}
              />
            </label>
            <SubmitButton className="btn btn-secondary">Add</SubmitButton>
          </form>
          <form action={removeSponsorAction.bind(null, slug)}>
            <SubmitButton className="inline-flex min-h-6 items-center text-danger underline">
              Take {sponsor.name} off the site
            </SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
