import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RefreshAt } from "@/app/app/sponsor/[sponsor]/code/refresh";
import { db } from "@/db/client";
import { eventBySlug } from "@/db/queries/events";
import { giveawayCodeSecret } from "@/db/queries/giveaways";
import { encodeQr, qrPath } from "@/domain/qr/encode";
import { checkinCode, codeTurnsOverAt } from "@/domain/sponsors/checkin-code";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { absoluteUrl, siteOrigin } from "@/lib/site";

export const metadata: Metadata = { title: "Giveaway entry code" };

type Props = PageProps<"/app/admin/events/[event]/giveaway/code">;

/**
 * The giveaway's rotating entry code, for a phone or screen at the event.
 * It is the sponsors' check-in code (ADR 0016) under the giveaway's own
 * secret, so a photo of it stops working within minutes and only people
 * at the event can enter.
 */
export default function GiveawayCodePage(props: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <Suspense fallback={<p className="min-h-svh">Loading the code…</p>}>
        <Code {...props} />
      </Suspense>
    </main>
  );
}

async function Code({ params }: Props) {
  const { event: slug } = await params;
  const page = `/app/admin/events/${slug}/giveaway/code`;
  await requirePermission("giveaway.manage", { next: page });
  const e = await eventBySlug(db, slug, "all");
  const g = e ? await giveawayCodeSecret(db, e.id) : null;
  if (!e || !g) notFound();
  await connection();
  const now = new Date();
  const code = checkinCode(g.secret, g.id, now);
  const link = absoluteUrl(
    siteOrigin(env.BETTER_AUTH_URL),
    `/app/events/${slug}/giveaway/enter/${code}`,
  );
  const qr = encodeQr(link);
  const side = qr.size + 8;
  return (
    <>
      <RefreshAt at={codeTurnsOverAt(now).getTime()} />
      <h1 className="font-display text-h1">Free giveaway: scan to enter</h1>
      <p className="text-body-lg">
        Check in at {e.title} with your phone&apos;s camera. One entry each, no
        purchase necessary.
      </p>
      <svg
        role="img"
        aria-label={`Giveaway entry code for ${e.title}`}
        viewBox={`0 0 ${side} ${side}`}
        shapeRendering="crispEdges"
        className="aspect-square w-full max-w-[min(80vmin,28rem)] rounded-card border-2 border-text"
      >
        <rect width={side} height={side} fill="#ffffff" />
        <path d={qrPath(qr)} fill="#000000" />
      </svg>
      <p className="text-small text-text-muted">
        Code <span className="font-mono text-text">{code}</span> · changes every
        few minutes, so keep this screen open.
      </p>
      <Link
        href={`/app/admin/events/${slug}/giveaway`}
        className="inline-flex min-h-11 items-center underline"
      >
        Back to the giveaway
      </Link>
    </>
  );
}
