import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { promoCodesForSeason } from "@/db/queries/promo-codes";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { formatCents } from "@/domain/registration/pricing";
import { describePromo } from "@/domain/registration/promo";
import { requirePermission } from "@/lib/auth/permission";
import { createPromoCodeAction, disablePromoCodeAction } from "./actions";

export const metadata: Metadata = { title: "Promo codes" };

export default function PromoCodesPage(
  props: PageProps<"/app/admin/seasons/[season]/promo-codes">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <PromoCodes {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  code: "Use 3 to 24 letters, numbers or dashes for the code, such as SPRING10.",
  kind: "Choose a percentage or an amount.",
  value:
    "Enter a whole percent from 1 to 100, or an amount in dollars such as 15 or 7.50.",
  maxRedemptions:
    "Enter how many times the code can be used, or leave it blank.",
  validUntil: "Pick the code's last day, or leave it blank.",
  duplicate: "This season already has that code.",
};
const NOTICES: Record<string, string> = {
  created: "Promo code added. Players can use it at checkout now.",
  disabled: "Promo code turned off.",
};

const input =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3";

async function PromoCodes({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/promo-codes">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("season.manage", {
    next: `/app/admin/seasons/${slug}/promo-codes`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const codes = await promoCodesForSeason(db, season.id);
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: season.timeZone,
  });
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Promo codes</h1>
        <p className="text-text-muted">
          Players type a code when they pay. It comes off what they owe for{" "}
          {season.name}, and Stripe charges the lower price.
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

      <section aria-labelledby="codes" className="flex flex-col gap-3">
        <h2 id="codes" className="text-h2">
          Codes
        </h2>
        {codes.length === 0 ? (
          <p className="text-text-muted">No promo codes yet.</p>
        ) : (
          <div
            role="region"
            aria-label="Promo codes table"
            // A scrolling region must be reachable by keyboard, even with no links.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="overflow-x-auto"
          >
            <table className="w-full min-w-[36rem] text-left">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Discount</th>
                  <th scope="col">Used</th>
                  <th scope="col">Last day</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const status = c.disabledAt
                    ? "Off"
                    : c.validUntil && now > c.validUntil
                      ? "Expired"
                      : c.maxRedemptions !== null &&
                          c.redemptions >= c.maxRedemptions
                        ? "Used up"
                        : "Live";
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <td className="py-2 font-mono">{c.code}</td>
                      <td>{describePromo(c, formatCents)}</td>
                      <td>
                        {c.redemptions}
                        {c.maxRedemptions !== null && ` of ${c.maxRedemptions}`}
                      </td>
                      <td>
                        {c.validUntil ? day.format(c.validUntil) : "None"}
                      </td>
                      <td>
                        {c.disabledAt ? (
                          status
                        ) : (
                          <form
                            action={disablePromoCodeAction.bind(
                              null,
                              slug,
                              c.id,
                            )}
                            className="flex flex-wrap items-center gap-3"
                          >
                            <span>{status}</span>
                            <button
                              type="submit"
                              className="inline-flex min-h-11 items-center underline"
                              aria-label={`Turn off ${c.code}`}
                            >
                              Turn off
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="new-code" className="flex flex-col gap-3">
        <h2 id="new-code" className="text-h2">
          New code
        </h2>
        <form
          action={createPromoCodeAction.bind(null, slug)}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1">
            Code
            <input
              name="code"
              required
              maxLength={24}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="SPRING10"
              className={`${input} w-48 uppercase`}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend>Takes off</legend>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  className="size-5 accent-brand"
                  type="radio"
                  name="kind"
                  value="percent"
                  defaultChecked
                />
                A percentage
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  className="size-5 accent-brand"
                  type="radio"
                  name="kind"
                  value="amount"
                />
                An amount in dollars
              </label>
            </div>
            <label className="flex flex-col gap-1">
              How much (percent or dollars)
              <input
                name="value"
                required
                inputMode="decimal"
                placeholder="10"
                className={`${input} w-28`}
              />
            </label>
          </fieldset>
          <label className="flex flex-col gap-1">
            How many times it can be used (optional)
            <input
              name="maxRedemptions"
              inputMode="numeric"
              placeholder="No limit"
              className={`${input} w-28`}
            />
          </label>
          <label className="flex flex-col gap-1">
            Last day it works (optional)
            <input name="validUntil" type="date" className={`${input} w-44`} />
          </label>
          <button type="submit" className="btn self-start btn-primary">
            Add promo code
          </button>
        </form>
      </section>
    </>
  );
}
