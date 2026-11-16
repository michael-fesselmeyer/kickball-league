import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  type ItemClaim,
  type ItemDetail,
  itemDetail,
} from "@/db/queries/lost-found";
import { can } from "@/domain/authz/permissions";
import { type LostFoundItemId, parseId } from "@/domain/ids";
import {
  daysLeft,
  MESSAGE_MAX,
  NOTICE_DONE,
  NOTICE_ERRORS,
} from "@/domain/lost-found/rules";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  answerAction,
  closeAction,
  handOverAction,
  removeAction,
  withdrawAction,
  writeAction,
} from "../actions";

export const metadata: Metadata = { title: "Lost and found post" };

export default function ItemPage(
  props: PageProps<"/[lang]/app/lost-and-found/[item]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Link
        href="/app/lost-and-found"
        className="inline-flex min-h-11 items-center self-start underline"
      >
        Lost and found
      </Link>
      <Suspense fallback={<PageLoading>Loading the post…</PageLoading>}>
        <Item {...props} />
      </Suspense>
    </main>
  );
}

const CLOSED: Record<ItemDetail["status"], string> = {
  open: "",
  returned: "Handed over. This post is closed.",
  closed: "The poster closed this post.",
  expired: "Closed after 30 days.",
  removed: "An admin took this post down.",
};

const field =
  "min-h-11 rounded-input border border-border-strong bg-bg px-3 py-2";

async function Item({
  params,
  searchParams,
}: PageProps<"/[lang]/app/lost-and-found/[item]">) {
  const id = parseId<LostFoundItemId>((await params).item);
  const subject = await requirePermission("lost_found.use", {
    next: `/app/lost-and-found/${(await params).item}`,
  });
  const league = await activeLeague();
  if (!id || !league) notFound();
  const item = await itemDetail(db, {
    leagueId: league.id,
    itemId: id,
    viewerId: subject.userId,
  });
  if (!item) notFound();
  const query = await searchParams;
  const done =
    typeof query.done === "string" ? NOTICE_DONE[query.done] : undefined;
  const error =
    typeof query.error === "string" ? NOTICE_ERRORS[query.error] : undefined;
  const open = item.status === "open";
  const mineClaim = item.claims[0];
  const admin = can(subject, "lost_found.manage");
  const time = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: league.timeZone,
  });
  return (
    <>
      {done && (
        <p role="status" className="font-bold">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="font-bold text-danger">
          {error}
        </p>
      )}
      <header className="flex flex-col gap-1">
        <p className="text-small font-bold text-text-muted uppercase">
          {item.kind === "found" ? "Found" : "Lost"}
        </p>
        <h1 className="text-h1">{item.description}</h1>
        <p className="text-text-muted">
          {item.kind === "found" ? "Found at" : "Lost at"} {item.place}
          {item.whereNow ? ` · Now: ${item.whereNow}` : ""}
        </p>
        <p className="text-small text-text-muted">
          {item.mine ? "Your post" : `Posted by ${item.posterName}`} ·{" "}
          {time.format(item.postedAt)}
          {open ? ` · ${daysLeft(item.postedAt, new Date())} days left` : ""}
        </p>
      </header>
      {item.hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/app/lost-and-found/${item.id}/photo`}
          alt={item.description}
          width={item.width ?? undefined}
          height={item.height ?? undefined}
          decoding="async"
          className="max-h-96 w-full rounded-card border border-border object-contain"
        />
      )}
      {!open && (
        <p role="status" className="rounded-card border-2 border-border p-4">
          {CLOSED[item.status]}
        </p>
      )}

      {open && !item.mine && !mineClaim && (
        <form
          action={answerAction}
          className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <input type="hidden" name="item" value={item.id} />
          <label className="flex flex-col gap-1 font-bold">
            {item.kind === "found"
              ? "Say why it's yours (optional)"
              : "Say where you found it (optional)"}
            <textarea
              name="message"
              rows={3}
              maxLength={MESSAGE_MAX}
              className={`${field} font-normal`}
            />
          </label>
          <SubmitButton className="btn self-start btn-primary">
            {item.kind === "found" ? "That's mine" : "I found it"}
          </SubmitButton>
          <p className="text-small text-text-muted">
            {item.posterName} is told, and you talk here. Nobody&apos;s contact
            details are shared.
          </p>
        </form>
      )}

      {item.mine && (
        <section aria-labelledby="answers" className="flex flex-col gap-3">
          <h2 id="answers" className="text-h2">
            Answers
          </h2>
          {item.claims.length === 0 ? (
            <p className="text-text-muted">No answers yet.</p>
          ) : (
            item.claims.map((c) => (
              <Conversation key={c.id} item={item} claim={c} time={time} />
            ))
          )}
          {open && (
            <form action={closeAction}>
              <input type="hidden" name="item" value={item.id} />
              <SubmitButton className="btn btn-secondary">
                Close this post
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      {!item.mine && mineClaim && (
        <section aria-labelledby="chat" className="flex flex-col gap-3">
          <h2 id="chat" className="text-h2">
            Your conversation with {item.posterName}
          </h2>
          <Conversation item={item} claim={mineClaim} time={time} />
        </section>
      )}

      {admin && open && (
        <form action={removeAction} className="border-t border-border pt-4">
          <input type="hidden" name="item" value={item.id} />
          <SubmitButton className="btn btn-secondary">
            Take this post down (admin)
          </SubmitButton>
        </form>
      )}
    </>
  );
}

const CLAIM_STATUS: Record<ItemClaim["status"], string> = {
  open: "",
  handed_over: "Handed over",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

function Conversation({
  item,
  claim,
  time,
}: {
  item: ItemDetail;
  claim: ItemClaim;
  time: Intl.DateTimeFormat;
}) {
  const live = item.status === "open" && claim.status === "open";
  return (
    <article
      aria-label={`Conversation with ${item.mine ? claim.responderName : item.posterName}`}
      className="flex flex-col gap-2 rounded-card border-2 border-text bg-surface p-3"
    >
      <h3 className="font-bold">
        {item.mine ? claim.responderName : item.posterName}
        {CLAIM_STATUS[claim.status] ? ` · ${CLAIM_STATUS[claim.status]}` : ""}
      </h3>
      <ul className="flex flex-col gap-2">
        {claim.messages.map((m) => (
          <li key={m.id} className="flex flex-col">
            <span className="text-small text-text-muted">
              {m.mine ? "You" : m.authorName} · {time.format(m.createdAt)}
            </span>
            <span className="whitespace-pre-wrap">{m.body}</span>
          </li>
        ))}
        {claim.messages.length === 0 && (
          <li className="text-text-muted">No messages yet.</li>
        )}
      </ul>
      {live && (
        <form action={writeAction} className="flex flex-col gap-2">
          <input type="hidden" name="item" value={item.id} />
          <input type="hidden" name="claim" value={claim.id} />
          <label className="flex flex-col gap-1 font-bold">
            Write back
            <textarea
              name="body"
              rows={2}
              required
              maxLength={MESSAGE_MAX}
              className={`${field} font-normal`}
            />
          </label>
          <SubmitButton className="btn self-start btn-secondary">
            Send
          </SubmitButton>
        </form>
      )}
      {live && item.mine && (
        <form action={handOverAction}>
          <input type="hidden" name="item" value={item.id} />
          <input type="hidden" name="claim" value={claim.id} />
          <SubmitButton className="btn btn-primary">
            Mark as handed over to {claim.responderName}
          </SubmitButton>
        </form>
      )}
      {live && !item.mine && (
        <form action={withdrawAction}>
          <input type="hidden" name="item" value={item.id} />
          <input type="hidden" name="claim" value={claim.id} />
          <SubmitButton className="btn btn-secondary">
            Take my answer back
          </SubmitButton>
        </form>
      )}
    </article>
  );
}
