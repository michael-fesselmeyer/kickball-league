import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { visibleEvent } from "@/db/queries/event-audience";
import { giveawayForEvent, giveawayStanding } from "@/db/queries/giveaways";
import { can } from "@/domain/authz/permissions";
import {
  ENTRY_REFUSALS,
  type EntryRefusal,
  giveawayPhase,
  NO_PURCHASE_LINE,
} from "@/domain/drive/giveaway";
import { formatMoment } from "@/domain/money/credit";
import { requirePermission } from "@/lib/auth/permission";

export const metadata: Metadata = { title: "Giveaway" };

type Props = PageProps<"/app/events/[event]/giveaway">;

/**
 * An event's free giveaway: the prize, how to enter, the official rules,
 * and where the player stands. Winners are never named here.
 */
export default function GiveawayPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the giveaway…</p>}>
        <Giveaway {...props} />
      </Suspense>
    </main>
  );
}

const NOTICES: Record<string, string> = {
  entered: "You're in! Good luck. Winners are drawn after entry closes.",
  already: "You're already entered. One entry per person.",
};

const isRefusal = (value: string): value is EntryRefusal =>
  Object.hasOwn(ENTRY_REFUSALS, value);

async function Giveaway({ params, searchParams }: Props) {
  const { event: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("giveaway.enter", {
    next: `/app/events/${slug}/giveaway`,
  });
  const e = await visibleEvent(
    db,
    slug,
    subject.userId,
    can(subject, "event.manage"),
  );
  const g = e ? await giveawayForEvent(db, e.id) : null;
  if (!e || !g) notFound();
  await connection();
  const standing = await giveawayStanding(db, g.id, subject.userId);
  const phase = giveawayPhase(g, new Date());
  const at = (d: Date) => formatMoment(d, e.timeZone);
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const error =
    typeof query.error === "string" && isRefusal(query.error)
      ? ENTRY_REFUSALS[query.error]
      : undefined;
  const rules = g.officialRules
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href={`/app/events/${slug}`}
          className="inline-flex min-h-11 items-center underline"
        >
          {e.title}
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          Free giveaway
        </p>
        <h1 className="text-h1">{g.prize}</h1>
        {g.donatedBy && (
          <p className="text-text-muted">Thanks to {g.donatedBy}</p>
        )}
        <p className="font-bold">{NO_PURCHASE_LINE}</p>
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

      {standing.won ? (
        <p className="rounded-card border-2 border-success p-4 text-body-lg font-bold">
          <span aria-hidden="true">🎉 </span>You won! The official rules below
          say how to claim it.
        </p>
      ) : standing.entered ? (
        <p className="rounded-card border-2 border-border p-4">
          <span aria-hidden="true">✓ </span>You&apos;re entered
          {phase === "drawn"
            ? ". The winners are drawn, and this time it wasn't you."
            : `. Winners are drawn after entry closes ${at(g.closesAt)}.`}
        </p>
      ) : null}

      <section aria-labelledby="how" className="flex flex-col gap-2">
        <h2 id="how" className="text-h2">
          How to enter
        </h2>
        <p>
          {phase === "not_open"
            ? `Entry opens ${at(g.opensAt)} and closes ${at(g.closesAt)}.`
            : phase === "open"
              ? `Entry is open until ${at(g.closesAt)}.`
              : "Entry has closed."}{" "}
          Check in at {e.title} by scanning the giveaway code there with your
          phone&apos;s camera. One entry per person.
        </p>
        <p className="text-text-muted">
          {standing.entries}{" "}
          {standing.entries === 1 ? "person has" : "people have"} entered.{" "}
          {phase === "drawn"
            ? `${standing.winners} ${standing.winners === 1 ? "winner was" : "winners were"} drawn at random.`
            : `${g.winnerCount} ${g.winnerCount === 1 ? "winner" : "winners"} will be drawn at random.`}
        </p>
      </section>

      <section aria-labelledby="rules" className="flex flex-col gap-2">
        <h2 id="rules" className="text-h2">
          Official rules
        </h2>
        {rules.map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </section>
    </>
  );
}
