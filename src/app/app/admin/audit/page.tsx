import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { auditLogPage } from "@/db/queries/audit";
import { currentLeague } from "@/db/queries/seasons";
import {
  describeAction,
  describeChange,
  isOperatorAction,
} from "@/domain/audit/describe";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage(props: PageProps<"/app/admin/audit">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Audit {...props} />
      </Suspense>
    </main>
  );
}

async function Audit({ searchParams }: PageProps<"/app/admin/audit">) {
  await requirePermission("audit.read", { next: "/app/admin/audit" });
  const query = await searchParams;
  const operatorOnly = query.only === "operator";
  const before =
    typeof query.before === "string" && !Number.isNaN(Date.parse(query.before))
      ? new Date(query.before)
      : undefined;
  const [league, page] = await Promise.all([
    currentLeague(db),
    auditLogPage(db, { before, operatorOnly }),
  ]);
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: league?.timeZone ?? "America/New_York",
  });
  const filter = operatorOnly ? "&only=operator" : "";
  const oldest = page.rows.at(-1)?.occurredAt;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/app/admin" className="self-start underline">
          League admin
        </Link>
        <h1 className="text-h1">Audit log</h1>
        <p className="text-text-muted">
          Every change admins, captains and the platform operator made, and
          every data download, newest first.
        </p>
        <p className="flex flex-wrap gap-3">
          <Link
            href="/app/admin/audit"
            aria-current={operatorOnly ? undefined : "page"}
            className="underline"
          >
            Everything
          </Link>
          <Link
            href="/app/admin/audit?only=operator"
            aria-current={operatorOnly ? "page" : undefined}
            className="underline"
          >
            Platform operator only
          </Link>
        </p>
      </header>
      {page.rows.length === 0 ? (
        <p className="text-text-muted">Nothing recorded here yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {page.rows.map((row) => {
            const changes = describeChange(row.before, row.after);
            return (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded-lg border border-border p-3"
              >
                <p className="font-semibold">
                  {describeAction(row.action)}
                  {isOperatorAction(row.action) && (
                    <span className="ml-2 text-small font-normal text-text-muted">
                      (platform operator)
                    </span>
                  )}
                </p>
                <p className="text-small text-text-muted">
                  {row.actorName ?? row.actorEmail ?? "Someone no longer here"}{" "}
                  ·{" "}
                  <time dateTime={row.occurredAt.toISOString()}>
                    {when.format(row.occurredAt)}
                  </time>
                </p>
                {changes.length > 0 && (
                  <ul className="text-small">
                    {changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {page.more && oldest && (
        <Link
          href={`/app/admin/audit?before=${encodeURIComponent(oldest.toISOString())}${filter}`}
          className="self-start underline"
        >
          Older
        </Link>
      )}
    </>
  );
}
