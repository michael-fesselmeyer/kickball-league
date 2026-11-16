import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RefreshAt } from "@/app/[lang]/app/sponsor/[sponsor]/code/refresh";
import { db } from "@/db/client";
import { attendanceGame } from "@/db/queries/attendance";
import {
  codeTurnsOverAt,
  fieldCode,
  scanOpen,
} from "@/domain/attendance/attendance";
import { type GameId, parseId } from "@/domain/ids";
import { encodeQr, qrPath } from "@/domain/qr/encode";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { absoluteUrl, siteOrigin } from "@/lib/site";

export const metadata: Metadata = {
  title: "Game check-in code",
  robots: { index: false },
};

type Props = PageProps<"/[lang]/app/games/[game]/attendance/code">;

/**
 * The game's rotating check-in code, on the ref's or a captain's phone at
 * the field (ADR 0063). It is the sponsor check-in's code (ADR 0016) under
 * a key derived for this game, so a photo of it stops working within
 * minutes and says nothing about any other game.
 */
export default function AttendanceCodePage(props: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <Suspense fallback={<p className="min-h-svh">Loading the code…</p>}>
        <Code {...props} />
      </Suspense>
    </main>
  );
}

async function Code({ params }: Props) {
  const { game: rawId } = await params;
  const gameId = parseId<GameId>(rawId);
  const g = gameId ? await attendanceGame(db, gameId) : null;
  if (!g) notFound();
  await requirePermission("attendance.take", {
    next: `/app/games/${rawId}/attendance/code`,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
  });
  await connection();
  const now = new Date();
  const back = (
    <Link
      href={`/app/games/${g.id}/attendance`}
      className="inline-flex min-h-11 items-center underline"
    >
      Back to check-in
    </Link>
  );
  if (!scanOpen(g, now).ok)
    return (
      <>
        <h1 className="text-h1">Check-in code</h1>
        <p>The code shows on game day only.</p>
        {back}
      </>
    );
  const code = fieldCode(env.BETTER_AUTH_SECRET, g.id, now);
  const link = absoluteUrl(
    siteOrigin(env.BETTER_AUTH_URL),
    `/app/games/${g.id}/check-in/${code}`,
  );
  const qr = encodeQr(link);
  const side = qr.size + 8;
  return (
    <>
      <RefreshAt at={codeTurnsOverAt(now).getTime()} />
      <h1 className="font-display text-h1">Scan to check in</h1>
      <p className="text-body-lg">
        {g.teamAName} vs {g.teamBName}. Point your phone&apos;s camera here,
        then tap Check in.
      </p>
      <svg
        role="img"
        aria-label={`Check-in code for ${g.teamAName} vs ${g.teamBName}`}
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
      {back}
    </>
  );
}
