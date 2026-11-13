import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmItsYou } from "@/components/confirm-its-you";
import { db } from "@/db/client";
import { hasPasskey } from "@/db/queries/passkeys";
import { siteSettings, staff } from "@/db/queries/platform";
import { profileOf } from "@/db/queries/profile";
import {
  FEATURE_KEYS,
  FEATURES,
  SITE_STATUSES,
  type SiteStatus,
  featureOn,
} from "@/domain/platform/operator";
import {
  operatorIsFresh,
  requireOperator,
} from "@/lib/platform/require-operator";
import {
  setFeatureAction,
  setRoleAction,
  setSiteStatusAction,
} from "./actions";

// No title: the page must not hint that it exists to anyone else.
export const metadata: Metadata = { robots: { index: false } };

const STATUS_TEXT: Record<SiteStatus, { label: string; detail: string }> = {
  active: { label: "Active", detail: "Everything works." },
  read_only: {
    label: "Read-only",
    detail: "Everything stays visible; nobody but you can change anything.",
  },
  paused: {
    label: "Paused",
    detail:
      "Public pages show a neutral notice. Owners can still sign in and download the league's data.",
  },
};

const SAVED: Record<string, string> = {
  status: "Site status saved.",
  feature: "Feature switch saved.",
  role: "Role saved.",
};
const ERRORS: Record<string, string> = {
  no_account: "No account uses that email address.",
  bad_role: "Pick player, admin or owner.",
  bad_status: "Pick a site status.",
  bad_feature: "That feature doesn't exist.",
  no_league: "There is no league yet.",
  stale: "Confirm it's you first. Nothing was changed.",
};

export default function OperatorPage(props: PageProps<"/operator">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Console {...props} />
      </Suspense>
    </main>
  );
}

async function Console({ searchParams }: PageProps<"/operator">) {
  const operator = await requireOperator();
  const query = await searchParams;
  const [site, people, fresh, me, withPasskey] = await Promise.all([
    siteSettings(db),
    staff(db),
    operatorIsFresh(),
    profileOf(db, operator.userId),
    hasPasskey(db, operator.userId),
  ]);
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : null;
  const error = typeof query.error === "string" ? ERRORS[query.error] : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Operator</h1>
        <p className="text-text-muted">
          You run the platform; the league&apos;s owners run the league. Every
          change here is recorded in the audit log, which owners can see.
        </p>
      </header>

      {!fresh && me && (
        <ConfirmItsYou
          what="change anything"
          email={me.email}
          next="/operator"
          confirm={query.confirm}
          hasPasskey={withPasskey}
        />
      )}
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      {site && (
        <section aria-labelledby="status" className="flex flex-col gap-3">
          <h2 id="status" className="text-h2">
            Site status
          </h2>
          <p>
            {site.name} is <strong>{STATUS_TEXT[site.status].label}</strong>.{" "}
            {STATUS_TEXT[site.status].detail}
          </p>
          <form action={setSiteStatusAction} className="flex flex-col gap-2">
            <fieldset className="flex flex-col gap-2" disabled={!fresh}>
              <legend className="sr-only">Set the site status</legend>
              {SITE_STATUSES.map((s) => (
                <label key={s} className="flex min-h-11 items-start gap-3">
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    defaultChecked={s === site.status}
                    className="mt-0.5 size-5 shrink-0 accent-brand"
                  />
                  <span>
                    <strong>{STATUS_TEXT[s].label}.</strong>{" "}
                    {STATUS_TEXT[s].detail}
                  </span>
                </label>
              ))}
              <button
                type="submit"
                className="min-h-11 self-start rounded-full border-2 border-text px-5 font-semibold"
              >
                Save status
              </button>
            </fieldset>
          </form>
        </section>
      )}

      {site && (
        <section aria-labelledby="features" className="flex flex-col gap-3">
          <h2 id="features" className="text-h2">
            Features
          </h2>
          <ul className="flex flex-col gap-2">
            {FEATURE_KEYS.map((f) => {
              const on = featureOn(site.disabledFeatures, f);
              return (
                <li
                  key={f}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <span>
                    {FEATURES[f]}: <strong>{on ? "on" : "off"}</strong>
                  </span>
                  <form action={setFeatureAction}>
                    <input type="hidden" name="feature" value={f} />
                    <input
                      type="hidden"
                      name="on"
                      value={on ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      disabled={!fresh}
                      className="inline-flex min-h-11 items-center underline disabled:no-underline disabled:opacity-60"
                    >
                      Turn {on ? "off" : "on"}
                      <span className="sr-only">
                        {" "}
                        {FEATURES[f].toLowerCase()}
                      </span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="roles" className="flex flex-col gap-3">
        <h2 id="roles" className="text-h2">
          Owners and admins
        </h2>
        {people.length === 0 ? (
          <p className="text-text-muted">Nobody has an admin role yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {people.map((p) => (
              <li key={p.userId}>
                {[p.firstName, p.lastName].filter(Boolean).join(" ") || p.email}{" "}
                <span className="text-text-muted">
                  ({p.email}, {p.role})
                </span>
              </li>
            ))}
          </ul>
        )}
        <form action={setRoleAction} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-3" disabled={!fresh}>
            <legend className="font-semibold">
              Change a person&apos;s role
            </legend>
            <label className="flex flex-col gap-1">
              Their account email
              <input
                type="email"
                name="email"
                required
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
              />
            </label>
            <label className="flex flex-col gap-1">
              Role
              <select
                name="role"
                defaultValue="admin"
                className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
              >
                <option value="player">Player</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <button
              type="submit"
              className="min-h-11 self-start rounded-full border-2 border-text px-5 font-semibold"
            >
              Save role
            </button>
          </fieldset>
        </form>
      </section>

      <section aria-labelledby="export" className="flex flex-col gap-2">
        <h2 id="export" className="text-h2">
          League data
        </h2>
        <p className="text-text-muted">
          Everything the league needs to run elsewhere, as JSON. Owners can
          download the same file from their admin pages.
        </p>
        <a
          href="/app/admin/league.json"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Download the league export
        </a>
      </section>
    </>
  );
}
