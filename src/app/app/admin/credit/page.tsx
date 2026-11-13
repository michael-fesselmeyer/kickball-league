import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { creditOverview } from "@/db/queries/credit";
import { currentLeague } from "@/db/queries/seasons";
import { describeCredit, GOODWILL_MAX_CENTS } from "@/domain/money/credit";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { grantGoodwillAction } from "./actions";

export const metadata: Metadata = { title: "League credit" };

export default function CreditPage(props: PageProps<"/app/admin/credit">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Credit {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  email: "Enter the player's email address.",
  amount: `Enter dollars from 0.01 to ${GOODWILL_MAX_CENTS / 100}, such as 15 or 7.50.`,
  note: "Say why, in up to 200 characters. The player sees it.",
  unknown_player: "Nobody with that email has an account yet.",
};

const input = "rounded-md border border-border bg-surface px-2 py-1";

async function Credit({ searchParams }: PageProps<"/app/admin/credit">) {
  const query = await searchParams;
  await requirePermission("refund.issue", { next: "/app/admin/credit" });
  const [league, overview] = await Promise.all([
    currentLeague(db),
    creditOverview(db),
  ]);
  const day = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: league?.timeZone ?? "America/New_York",
  });
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const total = overview.holders.reduce((sum, h) => sum + h.balance, 0);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          Admin
        </Link>
        <h1 className="text-h1">League credit</h1>
        <p className="text-text-muted">
          Credit comes off a player&apos;s next fee at checkout. Rain-out
          rebates and referrals add it on their own; give goodwill credit here.
          It is cheaper than a refund and keeps players for next season.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {query.notice === "granted" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Credit given. It shows on the player&apos;s account and comes off
          their next fee.
        </p>
      )}

      <section aria-labelledby="give" className="flex flex-col gap-3">
        <h2 id="give" className="text-h2">
          Give credit
        </h2>
        <form action={grantGoodwillAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-small">Player&apos;s email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 self-start">
            <span className="text-small">Amount in dollars</span>
            <input
              name="amount"
              inputMode="decimal"
              required
              autoComplete="off"
              className={`${input} w-32`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small">Why (the player sees this)</span>
            <input name="note" required maxLength={200} className={input} />
          </label>
          <button type="submit" className="btn self-start btn-primary">
            Give credit
          </button>
        </form>
      </section>

      <section aria-labelledby="holders" className="flex flex-col gap-3">
        <h2 id="holders" className="text-h2">
          Who holds credit
        </h2>
        {overview.holders.length === 0 ? (
          <p className="text-text-muted">Nobody holds credit yet.</p>
        ) : (
          <>
            <p className="text-text-muted">
              {formatCents(total)} outstanding across {overview.holders.length}{" "}
              {overview.holders.length === 1 ? "player" : "players"}.
            </p>
            <ul className="flex flex-col">
              {overview.holders.map((h) => (
                <li
                  key={h.userId}
                  className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
                >
                  <span className="flex flex-col">
                    <span>{h.name}</span>
                    <span className="text-small text-text-muted">
                      {h.email}
                    </span>
                  </span>
                  <span>{formatCents(h.balance)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <h2 id="recent" className="text-h2">
          Recently given
        </h2>
        {overview.recent.length === 0 ? (
          <p className="text-text-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col">
            {overview.recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
              >
                <span className="flex flex-col">
                  <span>
                    {r.name} · {describeCredit(r.reason)}
                  </span>
                  <span className="text-small text-text-muted">
                    {day.format(r.createdAt)}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </span>
                <span className="text-success">
                  +{formatCents(r.deltaCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
