import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConfirmItsYou } from "@/components/confirm-its-you";
import { db } from "@/db/client";
import {
  type AccountSummary,
  accountSummary,
  mergePreview,
  recentMerges,
} from "@/db/queries/account-merge";
import { hasPasskey } from "@/db/queries/passkeys";
import { currentLeague } from "@/db/queries/seasons";
import { describeBlocker } from "@/domain/account-merge/rules";
import { parseId, type UserId } from "@/domain/ids";
import { requirePermission, sessionIsFresh } from "@/lib/auth/permission";
import { findAccountsAction, mergeAccountsAction } from "./actions";

export const metadata: Metadata = { title: "Merge accounts" };

export default function AccountsPage(props: PageProps<"/app/admin/accounts">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <Accounts {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  no_keep: "No account has the address to keep.",
  no_merge:
    "No account has the address to merge away, or it was already merged.",
  stale: "Confirm it's you first, then merge.",
  unconfirmed: "Tick the box to say both accounts are the same person.",
  blocked: "Something changed since the preview. Check it again below.",
};

const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

function Account({
  title,
  account,
  day,
}: {
  title: string;
  account: AccountSummary;
  day: Intl.DateTimeFormat;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <p className="text-small text-text-muted">{title}</p>
      <p className="font-bold">{account.name}</p>
      <p className="break-all">{account.email}</p>
      <p className="text-small text-text-muted">
        Joined {day.format(account.createdAt)}
        {account.role !== "player" ? ` · ${account.role}` : ""}
      </p>
    </div>
  );
}

async function Accounts({ searchParams }: PageProps<"/app/admin/accounts">) {
  const query = await searchParams;
  const subject = await requirePermission("accounts.merge", {
    next: "/app/admin/accounts",
  });
  const keptId = parseId<UserId>(query.keep);
  const mergedId = parseId<UserId>(query.merge);
  const mergedInto = parseId<UserId>(query.merged);
  const [league, preview, fresh, me, withPasskey, recent, done] =
    await Promise.all([
      currentLeague(db),
      keptId && mergedId
        ? mergePreview(db, { keptId, mergedId, actorId: subject.userId })
        : null,
      sessionIsFresh(),
      accountSummary(db, subject.userId),
      hasPasskey(db, subject.userId),
      recentMerges(db),
      mergedInto ? accountSummary(db, mergedInto) : null,
    ]);
  const day = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: league?.timeZone ?? "America/New_York",
  });
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          Admin
        </Link>
        <h1 className="text-h1">Merge accounts</h1>
        <p className="text-text-muted">
          When a player signed up twice, merge the extra account into the one
          they use. Their registrations, payments, credit, waivers, RSVPs,
          votes, photos and everything else move over in one go, and the old
          address keeps working as another name for the kept account.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-lg border border-success p-3">
          Merged. Everything now belongs to {done.name} ({done.email}).
        </p>
      )}

      <section aria-labelledby="pick" className="flex flex-col gap-3">
        <h2 id="pick" className="text-h2">
          Pick the two accounts
        </h2>
        <form action={findAccountsAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>Email of the account to keep</span>
            <input
              name="keep"
              type="email"
              required
              autoComplete="off"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Email of the account to merge away</span>
            <input
              name="merge"
              type="email"
              required
              autoComplete="off"
              className={input}
            />
          </label>
          <button type="submit" className="btn self-start btn-secondary">
            Preview the merge
          </button>
        </form>
      </section>

      {preview && (
        <section aria-labelledby="preview" className="flex flex-col gap-4">
          <h2 id="preview" className="text-h2">
            Preview
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Account title="Keep" account={preview.kept} day={day} />
            <Account title="Merge away" account={preview.merged} day={day} />
          </div>

          {preview.blockers.length > 0 ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-danger p-3"
            >
              <p className="font-bold">This merge can&apos;t go ahead yet.</p>
              <ul className="list-disc pl-5">
                {preview.blockers.map((b) => (
                  <li key={JSON.stringify(b)}>{describeBlocker(b)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <h3 className="text-h3">What moves to the kept account</h3>
            {preview.moves.length === 0 ? (
              <p className="text-text-muted">
                Nothing yet: the account to merge away has no records.
              </p>
            ) : (
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {preview.moves.map((m) => (
                  <li
                    key={m.label}
                    className="flex justify-between gap-3 border-b border-border py-1"
                  >
                    <span>{m.label}</span>
                    <span className="tabular-nums">{m.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-h3">Clashes and how they&apos;re settled</h3>
            {preview.conflicts.length === 0 ? (
              <p className="text-text-muted">No clashes.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {preview.conflicts.map((c) => (
                  <li key={c.label} className="border-b border-border py-1">
                    {c.label}{" "}
                    <span className="text-text-muted">({c.count})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {preview.blockers.length === 0 &&
            (!fresh && me ? (
              <ConfirmItsYou
                what="merge accounts"
                email={me.email}
                next={`/app/admin/accounts?keep=${preview.kept.id}&merge=${preview.merged.id}`}
                confirm={query.confirm}
                hasPasskey={withPasskey}
              />
            ) : (
              <form
                action={mergeAccountsAction}
                className="flex flex-col gap-3 rounded-lg border border-border p-3"
              >
                <input type="hidden" name="keptId" value={preview.kept.id} />
                <input
                  type="hidden"
                  name="mergedId"
                  value={preview.merged.id}
                />
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="same" className="mt-1" />
                  <span>
                    I&apos;ve checked that both accounts belong to the same
                    person. The account to merge away can&apos;t sign in
                    afterwards.
                  </span>
                </label>
                <button
                  type="submit"
                  className="btn self-start border-danger bg-surface text-danger"
                >
                  Merge into {preview.kept.name}
                </button>
              </form>
            ))}
        </section>
      )}

      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <h2 id="recent" className="text-h2">
          Recent merges
        </h2>
        {recent.length === 0 ? (
          <p className="text-text-muted">No accounts merged yet.</p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
              >
                <span className="break-all">
                  {r.mergedEmail} → {r.keptEmail}
                </span>
                <span className="text-small text-text-muted">
                  {day.format(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
