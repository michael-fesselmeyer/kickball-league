import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { demoMail } from "@/db/queries/demo";
import { rendererFor } from "@/emails/templates";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { demoStatus } from "@/lib/demo/guard";

export const metadata: Metadata = { title: "Demo mail" };

const PAGE = "/app/admin/demo-mail";

const STATUS: Record<string, string> = {
  queued: "Would send now",
  held: "Held for the digest",
  digested: "Went out in a digest",
  suppressed: "Not sent on purpose",
  sending: "Sending",
  sent: "Sent",
  failed: "Could not be built",
};

/**
 * What the league would have emailed (docs/demo.md): the demo has no email
 * provider, so every notice stays in the outbox, and admins can read them
 * here as each person would get them. Demo only: a 404 on the league's site,
 * where real people's mail is nobody's to browse.
 */
export default function DemoMailPage({
  searchParams,
}: PageProps<"/app/admin/demo-mail">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Demo mail</h1>
        <p className="text-text-muted">
          Everything the league would have emailed, newest first. In the demo
          nothing leaves this computer; on the league&apos;s site these go out
          by email (and by push to anyone who turned it on).
        </p>
      </header>
      <Suspense fallback={<p className="min-h-96">Loading mail…</p>}>
        <Mail searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Mail({
  searchParams,
}: Pick<PageProps<"/app/admin/demo-mail">, "searchParams">) {
  if (!demoStatus(process.env).on) notFound();
  await requirePermission("demo.manage", { next: PAGE });
  const [rows, query] = await Promise.all([demoMail(db), searchParams]);
  const failed = query.reset === "failed" && (
    <p role="alert" className="rounded-lg border border-danger p-3">
      The demo couldn&apos;t be reset. The terminal running the demo says why,
      and <code>npm run demo:reset</code> there tries again.
    </p>
  );
  if (rows.length === 0)
    return (
      <>
        {failed}
        <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
          No mail yet. Call a rain-out, pay for a season or post a score, then
          come back.
        </p>
      </>
    );
  const render = rendererFor({ siteUrl: env.BETTER_AUTH_URL });
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return (
    <>
      {failed}
      <ol className="flex flex-col gap-3">
        {rows.map((row) => {
          const email = render(row.template, row.payload);
          const subject = email.ok ? email.value.subject : row.template;
          return (
            <li
              key={row.id}
              className="rounded-card border-2 border-text bg-surface"
            >
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-col gap-1 p-3">
                  <span className="font-bold">{subject}</span>
                  <span className="text-small text-text-muted">
                    To {row.name} ({row.email}) · {when.format(row.createdAt)} ·{" "}
                    {STATUS[row.status] ?? row.status}
                  </span>
                </summary>
                {email.ok ? (
                  <iframe
                    title={`Email: ${subject}`}
                    srcDoc={email.value.html}
                    sandbox=""
                    className="h-[32rem] w-full border-t-2 border-text"
                  />
                ) : (
                  <p className="border-t-2 border-text p-3 text-text-muted">
                    This message could not be shown: {email.error}
                  </p>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </>
  );
}
