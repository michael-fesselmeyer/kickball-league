import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { eventBySlug } from "@/db/queries/events";
import {
  entryCount,
  giveawayForEvent,
  giveawayWinners,
} from "@/db/queries/giveaways";
import {
  blankGiveawayForm,
  DRAW_METHOD,
  eventCanHoldGiveaway,
  giveawayFormValues,
  giveawayPhase,
  HOLD_ERRORS,
  MAX_REASON_LENGTH,
  REDRAW_REASON_ERROR,
} from "@/domain/drive/giveaway";
import { whenLine } from "@/domain/events/event";
import { isTicketed } from "@/domain/events/tickets";
import { formatMoment } from "@/domain/money/credit";
import { requirePermission } from "@/lib/auth/permission";
import { drawAction, redrawAction, saveGiveawayAction } from "./actions";
import { GiveawayFormFields } from "./giveaway-form";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Event giveaway" };

type Props = PageProps<"/app/admin/events/[event]/giveaway">;

export default function AdminGiveawayPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the giveaway…</PageLoading>}>
        <AdminGiveaway {...props} />
      </Suspense>
    </main>
  );
}

const SAVED: Record<string, string> = {
  created: "Giveaway added. Show its code at the event so players can enter.",
  updated: "Giveaway saved.",
  drawn: "Winners drawn. They'll see it in the app and get one message.",
  redrawn: "New winner drawn. The reason is in the audit log.",
};

const ERRORS: Record<string, string> = {
  confirm: "Tick the box to confirm the draw first.",
  drawn: "The winners are already drawn.",
  still_open: "Entry is still open. Draw once it closes.",
  no_entries: "Nobody entered, so there's no one to draw.",
  not_drawn: "Draw the winners first.",
  not_a_winner: "That winner was already replaced.",
  no_one_left: "Everyone who entered has already been drawn.",
  reason: REDRAW_REASON_ERROR,
  not_found: "That giveaway is gone.",
};

async function AdminGiveaway({ params, searchParams }: Props) {
  const { event: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/events/${slug}/giveaway`;
  await requirePermission("giveaway.manage", { next: page });
  const e = await eventBySlug(db, slug, "all");
  if (!e) notFound();
  await connection();
  const g = await giveawayForEvent(db, e.id);
  const [entries, winners] = g
    ? await Promise.all([entryCount(db, g.id), giveawayWinners(db, g.id)])
    : [0, []];
  const now = new Date();
  const holds = eventCanHoldGiveaway({ kind: e.kind, ticketed: isTicketed(e) });
  const phase = g ? giveawayPhase(g, now) : null;
  const at = (d: Date) => formatMoment(d, e.timeZone);
  const saved =
    typeof query.saved === "string" ? SAVED[query.saved] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const current = winners.filter((w) => w.replacedAt === null);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/events/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {e.title}
        </Link>
        <h1 className="text-h1">Giveaway</h1>
        <p className="text-text-muted">{whenLine(e, e.timeZone)}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {!holds.ok && (
        <p className="rounded-lg border-2 border-warning p-3">
          {HOLD_ERRORS[holds.error]}
        </p>
      )}

      <section aria-labelledby="free" className="flex flex-col gap-2">
        <h2 id="free" className="text-h2">
          Free to enter
        </h2>
        <p>
          A giveaway is free: players enter by checking in at the event with the
          code below, once each. Never tie it to a ticket, a payment or a
          registration fee. A raffle people pay to enter is gambling under New
          York law, which only licensed nonprofits may run.
        </p>
      </section>

      {g && phase && (
        <section aria-labelledby="status" className="flex flex-col gap-3">
          <h2 id="status" className="text-h2">
            {g.prize}
          </h2>
          <p>
            {entries} {entries === 1 ? "entry" : "entries"} · {g.winnerCount}{" "}
            {g.winnerCount === 1 ? "winner" : "winners"}
          </p>
          <p className="text-text-muted">
            Entry {phase === "not_open" ? "opens" : "opened"} {at(g.opensAt)}{" "}
            and {phase === "open" || phase === "not_open" ? "closes" : "closed"}{" "}
            {at(g.closesAt)}.
          </p>
          {(phase === "open" || phase === "not_open") && holds.ok && (
            <Link href={`${page}/code`} className="btn self-start btn-primary">
              Show the entry code
            </Link>
          )}
          {phase === "closed" && (
            <form
              action={drawAction.bind(null, slug)}
              className="flex flex-col gap-3 rounded-card border-2 border-border p-4"
            >
              <p>
                The app picks{" "}
                {g.winnerCount === 1
                  ? "one winner"
                  : `${g.winnerCount} winners`}{" "}
                at random from all {entries} entries. The draw and its result go
                into the audit log.
              </p>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="confirm"
                  value="yes"
                  required
                  className="size-5 accent-brand"
                />
                Entry is closed and I&apos;m ready to draw
              </label>
              <SubmitButton className="btn self-start btn-primary">
                Draw the winners
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      {g && winners.length > 0 && (
        <section aria-labelledby="winners" className="flex flex-col gap-3">
          <h2 id="winners" className="text-h2">
            Winners
          </h2>
          <p className="text-small text-text-muted">
            Drawn {at(g.drawnAt ?? now)} by {DRAW_METHOD}.
          </p>
          <ul className="flex flex-col gap-3">
            {winners.map((w) => (
              <li
                key={w.id}
                className={`flex flex-col gap-2 rounded-card border-2 p-4 ${
                  w.replacedAt ? "border-border" : "border-success"
                }`}
              >
                <p className="font-bold">
                  {w.replacedAt ? <s>{w.name}</s> : w.name}
                  {w.round > 1 && (
                    <span className="font-normal text-text-muted">
                      {" "}
                      · redraw {w.round - 1}
                    </span>
                  )}
                </p>
                {w.replacedAt ? (
                  <p className="text-small text-text-muted">
                    Replaced {at(w.replacedAt)}: {w.replacedReason}
                  </p>
                ) : (
                  <details>
                    <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
                      Replace this winner
                    </summary>
                    <form
                      action={redrawAction.bind(null, slug, w.id)}
                      className="mt-2 flex flex-col gap-2"
                    >
                      <label htmlFor={`reason-${w.id}`} className="font-bold">
                        Why
                      </label>
                      <input
                        id={`reason-${w.id}`}
                        name="reason"
                        required
                        minLength={5}
                        maxLength={MAX_REASON_LENGTH}
                        placeholder="Didn't claim the prize in 14 days"
                        className="min-h-11 rounded-input border border-border-strong bg-surface px-3"
                      />
                      <SubmitButton className="btn self-start btn-secondary">
                        Draw a new winner
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {current.length === 0 && (
            <p className="text-text-muted">No current winner.</p>
          )}
        </section>
      )}

      {holds.ok && (!g || g.drawnAt === null) && (
        <section aria-labelledby="edit" className="flex flex-col gap-3">
          <h2 id="edit" className="text-h2">
            {g ? "Change the giveaway" : "Add a giveaway"}
          </h2>
          <GiveawayFormFields
            action={saveGiveawayAction.bind(null, slug)}
            values={
              g
                ? giveawayFormValues(g, e.timeZone)
                : blankGiveawayForm(e, e.timeZone)
            }
            submitLabel={g ? "Save the giveaway" : "Add the giveaway"}
          />
        </section>
      )}
    </>
  );
}
