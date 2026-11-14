import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { visibleEvent } from "@/db/queries/event-audience";
import {
  giveawayCodeSecret,
  giveawayForEvent,
  hasEntered,
} from "@/db/queries/giveaways";
import { can } from "@/domain/authz/permissions";
import { NO_PURCHASE_LINE } from "@/domain/drive/giveaway";
import { isCurrentCheckinCode } from "@/domain/sponsors/checkin-code";
import { requirePermission } from "@/lib/auth/permission";
import { enterGiveawayAction } from "../../actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Enter the giveaway" };

type Props = PageProps<"/app/events/[event]/giveaway/enter/[code]">;

/** Where the giveaway's code at the event lands: one tap to enter. */
export default function EnterPage(props: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Enter {...props} />
      </Suspense>
    </main>
  );
}

async function Enter({ params, searchParams }: Props) {
  const { event: slug, code } = await params;
  const query = await searchParams;
  const giveawayPage = `/app/events/${slug}/giveaway`;
  const subject = await requirePermission("giveaway.enter", {
    next: `${giveawayPage}/enter/${code}`,
  });
  const e = await visibleEvent(
    db,
    slug,
    subject.userId,
    can(subject, "event.manage"),
  );
  const [g, secret] = e
    ? await Promise.all([
        giveawayForEvent(db, e.id),
        giveawayCodeSecret(db, e.id),
      ])
    : [null, null];
  if (!e || !g || !secret) notFound();
  if (await hasEntered(db, g.id, subject.userId))
    redirect(`${giveawayPage}?notice=already`);
  await connection();
  const current =
    query.error !== "expired" &&
    isCurrentCheckinCode(secret.secret, g.id, code, new Date());
  if (!current)
    return (
      <>
        <h1 className="text-h1">That code has moved on</h1>
        <p role="alert">
          The giveaway code changes every few minutes, so this one has expired.
          Scan the code at {e.title} again.
        </p>
        <Link href={giveawayPage} className="btn btn-secondary">
          See the giveaway
        </Link>
      </>
    );

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-micro font-bold tracking-widest text-text-muted uppercase">
          Free giveaway
        </p>
        <h1 className="text-h1">Win {g.prize}</h1>
        <p className="text-text-muted">
          You&apos;re at {e.title}. One tap enters you, once.
        </p>
        <p className="text-small">{NO_PURCHASE_LINE}</p>
      </div>
      <form action={enterGiveawayAction.bind(null, slug, code)}>
        <button type="submit" className="btn w-full btn-primary">
          Enter the giveaway
        </button>
      </form>
      <Link
        href={giveawayPage}
        className="inline-flex min-h-11 items-center underline"
      >
        Official rules
      </Link>
    </>
  );
}
