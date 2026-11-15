import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { fieldPermitForGame } from "@/db/queries/books";
import { layoutForGame } from "@/db/queries/field-layouts";
import { fullWhen, kickoff } from "@/domain/schedule/format";
import { can } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { leadsSetupOn } from "@/lib/gameday/setup-lead";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = {
  title: "Park permit",
  robots: { index: false },
};

/**
 * The park permit at the field (ADR 0034): its number and document, for
 * the game's ref and both captains, in case a park officer asks. The home
 * screen saves this page on the phone with the next game, so it opens
 * without signal. The only place anyone but an owner sees a permit.
 */
export default function PermitPage(
  props: PageProps<"/app/games/[game]/permit">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading the permit…</PageLoading>}>
        <Permit {...props} />
      </Suspense>
    </main>
  );
}

async function Permit({ params }: PageProps<"/app/games/[game]/permit">) {
  const { game: rawId } = await params;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/permit`,
  });
  const gameId = parseId<GameId>(rawId);
  const [permit, layout] = gameId
    ? await Promise.all([
        fieldPermitForGame(db, gameId),
        layoutForGame(db, gameId),
      ])
    : [null, null];
  if (!permit) notFound();
  if (
    !can(subject, "permit.view_at_field", {
      game: {
        id: permit.gameId,
        teamSeasonIds: [permit.teamAId, permit.teamBId],
      },
      setupLead: await leadsSetupOn(subject, {
        seasonId: permit.seasonId,
        startsAt: permit.gameStartsAt,
        timeZone: permit.timeZone,
      }),
    })
  )
    notFound();
  const tz = permit.timeZone;
  const document = `/app/games/${permit.gameId}/permit/document`;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {permit.teamA} vs {permit.teamB} · {fullWhen(permit.gameStartsAt, tz)}
        </p>
        <h1 className="text-h1">Park permit</h1>
      </header>
      {permit.status === "lost" && (
        <p role="alert" className="rounded-lg border-2 border-danger p-3">
          The league lost this permit. Check with an admin before you play here.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-h3">
        <dt className="text-text-muted">Permit</dt>
        <dd className="font-bold">
          {permit.permitNumber ?? "No number on file"}
        </dd>
        <dt className="text-text-muted">Field</dt>
        <dd>
          {permit.venueName}, {permit.fieldName}
        </dd>
        <dt className="text-text-muted">Hours</dt>
        <dd>
          {kickoff(permit.windowStartsAt, tz)} to{" "}
          {kickoff(permit.windowEndsAt, tz)}
        </dd>
      </dl>
      {permit.documentFileId === null ? (
        <p className="text-text-muted">
          No copy of the permit is on file. Ask an owner to add one.
        </p>
      ) : permit.documentType === "application/pdf" ? (
        <a href={document} className="btn self-start btn-primary">
          Open the permit (PDF)
        </a>
      ) : (
        <figure className="flex flex-col gap-2">
          {/* A private, uncached file: next/image would cache it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={document}
            alt={`The park permit${permit.permitNumber ? ` ${permit.permitNumber}` : ""} for ${permit.fieldName}`}
            className="w-full rounded-lg border border-border"
          />
          <figcaption className="text-small text-text-muted">
            Show this to a park officer if asked.
          </figcaption>
        </figure>
      )}
      {layout && (layout.fileId !== null || layout.note) && (
        <section aria-labelledby="layout" className="flex flex-col gap-2">
          <h2 id="layout" className="text-h2">
            Field layout
          </h2>
          {layout.fileId !== null &&
            (layout.contentType === "application/pdf" ? (
              <a
                href={`/app/games/${permit.gameId}/permit/layout`}
                className="btn self-start btn-secondary"
              >
                Open the layout (PDF)
              </a>
            ) : (
              <figure className="flex flex-col gap-2">
                {/* A private, uncached file: next/image would cache it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/app/games/${permit.gameId}/permit/layout`}
                  alt={`Layout of ${permit.fieldName}: where the permitted area ends and where each diamond and spectator area goes`}
                  className="w-full rounded-lg border border-border"
                />
              </figure>
            ))}
          {layout.note && <p>{layout.note}</p>}
        </section>
      )}
      <Link href="/app" className="underline">
        Back to your home screen
      </Link>
    </>
  );
}
