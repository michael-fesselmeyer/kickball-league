import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { concernDetail } from "@/db/queries/concerns";
import {
  CATEGORY_LABELS,
  MAX_BODY,
  PARK_RULES,
} from "@/domain/concerns/concerns";
import { type ConcernId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { requireInLeague } from "@/lib/league/guard";
import { activeLeague } from "@/lib/league/active";
import { addMessageAction, closeAction, reopenAction } from "../actions";

export const metadata: Metadata = { title: "Concern" };

export default function ConcernPage(
  props: PageProps<"/[lang]/app/admin/concerns/[concern]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the message…</PageLoading>}>
        <Concern {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  text: "Write something first.",
  outcome: "Say what was done before closing.",
  closed: "This one is closed. Reopen it first.",
  not_closed: "This one is already open.",
  no_reply_to: "There is no address to reply to. Add a note instead.",
  not_found: "That message no longer exists.",
};
const NOTICES: Record<string, string> = {
  reply: "Reply sent.",
  note: "Note added.",
  closed: "Closed. The sender was told, if there is an address.",
  reopened: "Reopened.",
};
const field = "rounded-md border border-border bg-surface px-2 py-2";

async function Concern({
  params,
  searchParams,
}: PageProps<"/[lang]/app/admin/concerns/[concern]">) {
  const { concern: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("concern.review", {
    next: `/app/admin/concerns/${rawId}`,
  });
  const id = parseId<ConcernId>(rawId);
  if (!id) notFound();
  await requireInLeague(subject, { concern: id });
  const found = await concernDetail(db, id, subject.userId);
  if (!found) notFound();
  const league = await activeLeague();
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  const error = typeof query.error === "string" ? ERRORS[query.error] : null;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : null;
  const canReply = found.senderId !== null || found.replyEmail !== null;
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/incidents" className="underline">
          Incidents and concerns
        </Link>
        <h1 className="text-h1">{CATEGORY_LABELS[found.category]}</h1>
        <p className="text-small text-text-muted">
          {found.source === "public"
            ? "Public contact form"
            : "Private concern"}{" "}
          · {when(found.createdAt)} ·{" "}
          {found.status === "open"
            ? "Open"
            : `Closed ${found.closedAt ? when(found.closedAt) : ""}`}
        </p>
      </header>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <section aria-labelledby="what" className="flex flex-col gap-2">
        <h2 id="what" className="text-h2">
          What they said
        </h2>
        <p className="whitespace-pre-wrap">{found.body}</p>
        <dl className="text-small text-text-muted">
          {found.parkRule && (
            <div className="flex flex-wrap gap-x-1">
              <dt>Park rule:</dt>
              <dd>{PARK_RULES[found.parkRule]}</dd>
            </div>
          )}
          {found.occurredOn && (
            <div className="flex flex-wrap gap-x-1">
              <dt>Date:</dt>
              <dd>{found.occurredOn}</dd>
            </div>
          )}
          {found.place && (
            <div className="flex flex-wrap gap-x-1">
              <dt>Where:</dt>
              <dd>{found.place}</dd>
            </div>
          )}
          {found.gameId && (
            <div className="flex flex-wrap gap-x-1">
              <dt>Game:</dt>
              <dd>
                <Link href={`/app/games/${found.gameId}`} className="underline">
                  The game
                </Link>
              </dd>
            </div>
          )}
          <div className="flex flex-wrap gap-x-1">
            <dt>Sender:</dt>
            <dd>
              {found.senderName ??
                (found.replyEmail
                  ? `${found.replyEmail} (not signed in)`
                  : "Left no address")}
            </dd>
          </div>
        </dl>
        <p className="text-small text-text-muted">
          Only admins see this. Opening a sender&apos;s address is logged, and
          it is deleted 12 months after you close the message.
        </p>
      </section>
      <section aria-labelledby="thread" className="flex flex-col gap-3">
        <h2 id="thread" className="text-h2">
          Replies and notes
        </h2>
        {found.thread.length === 0 && (
          <p className="text-text-muted">Nothing yet.</p>
        )}
        <ul className="flex flex-col gap-3">
          {found.thread.map((m) => (
            <li key={m.id} className="border-t border-border pt-3">
              <span className="text-small text-text-muted">
                {m.kind === "reply" ? "Reply to the sender" : "Admin note"} ·{" "}
                {when(m.createdAt)}
              </span>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
        {found.outcome && (
          <p>
            <strong>What was done:</strong> {found.outcome}
          </p>
        )}
      </section>
      {found.status === "open" ? (
        <>
          {canReply && (
            <form
              action={addMessageAction.bind(null, found.id, "reply")}
              className="flex flex-col gap-2"
            >
              <label htmlFor="reply">Reply to the sender (emailed)</label>
              <textarea
                id="reply"
                name="text"
                rows={4}
                maxLength={MAX_BODY}
                required
                className={field}
              />
              <SubmitButton className="btn self-start btn-primary">
                Send reply
              </SubmitButton>
            </form>
          )}
          <form
            action={addMessageAction.bind(null, found.id, "note")}
            className="flex flex-col gap-2"
          >
            <label htmlFor="note">Add a note (admins only)</label>
            <textarea
              id="note"
              name="text"
              rows={3}
              maxLength={MAX_BODY}
              required
              className={field}
            />
            <SubmitButton className="btn self-start btn-secondary">
              Add note
            </SubmitButton>
          </form>
          <form
            action={closeAction.bind(null, found.id)}
            className="flex flex-col gap-2"
          >
            <label htmlFor="outcome">Close it: what was done</label>
            <textarea
              id="outcome"
              name="outcome"
              rows={2}
              maxLength={1000}
              required
              className={field}
            />
            <SubmitButton className="btn self-start btn-secondary">
              Close
            </SubmitButton>
          </form>
        </>
      ) : (
        <form action={reopenAction.bind(null, found.id)}>
          <SubmitButton className="btn btn-secondary">Reopen</SubmitButton>
        </form>
      )}
    </>
  );
}
