import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { sponsorForCheckIn } from "@/db/queries/sponsors";
import { encodeQr, qrPath } from "@/domain/qr/encode";
import { checkinCode, codeTurnsOverAt } from "@/domain/sponsors/checkin-code";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { RefreshAt } from "./refresh";

export const metadata: Metadata = { title: "Check-in code" };

type Props = PageProps<"/app/sponsor/[sponsor]/code">;

/**
 * The rotating check-in code, for a screen at the bar. It changes every
 * few minutes, so it is shown, not printed: a photo of it soon stops
 * working.
 */
export default function CodePage(props: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <Suspense fallback={<p className="min-h-svh">Loading the code…</p>}>
        <Code {...props} />
      </Suspense>
    </main>
  );
}

async function Code({ params }: Props) {
  const { sponsor: slug } = await params;
  const page = `/app/sponsor/${slug}/code`;
  const sponsor = await sponsorForCheckIn(db, slug);
  if (!sponsor) notFound();
  await requirePermission("sponsor.edit", {
    next: page,
    sponsorId: sponsor.id,
  });
  await connection();
  const now = new Date();
  const code = checkinCode(sponsor.secret, sponsor.id, now);
  const link = absoluteUrl(
    siteOrigin(env.BETTER_AUTH_URL),
    `/app/check-in/${slug}/${code}`,
  );
  const qr = encodeQr(link);
  const side = qr.size + 8;
  return (
    <>
      <RefreshAt at={codeTurnsOverAt(now).getTime()} />
      <h1 className="font-display text-h1">Played today? Check in!</h1>
      <p className="text-body-lg">
        Scan with your phone&apos;s camera to check in at {sponsor.name} and see
        today&apos;s deals.
      </p>
      <svg
        role="img"
        aria-label={`Check-in code for ${sponsor.name}`}
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
      <Link href={`/app/sponsor/${slug}`} className="underline">
        Back to {sponsor.name}
      </Link>
    </>
  );
}
