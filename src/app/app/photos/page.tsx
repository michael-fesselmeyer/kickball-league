import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  type ListedPhoto,
  myPhotos,
  photoStorage,
  uploadTargets,
} from "@/db/queries/member-photos";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import {
  leagueStorageFull,
  UPLOAD_MESSAGES,
} from "@/domain/member-photos/limits";
import { requireSelf } from "@/lib/auth/permission";
import { deleteMyPhotoAction, uploadPhotoAction } from "./actions";
import { UploadForm } from "./upload-form";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Share a photo" };

export default function PhotosPage(props: PageProps<"/app/photos">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">Share a photo</h1>
        <p className="text-text-muted">
          Got a great shot from a game day or an event? Send it in. Once the
          league approves it, it shows on the team, event or game page, and it
          may end up on the league&apos;s socials.
        </p>
      </header>
      <Suspense fallback={<PageLoading>Loading your photos…</PageLoading>}>
        <Photos {...props} />
      </Suspense>
    </main>
  );
}

const STATUS: Record<ListedPhoto["status"], string> = {
  pending: "Waiting for review",
  approved: "Up on the site",
  rejected: "Not used",
};

const first = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";

async function Photos({ searchParams }: PageProps<"/app/photos">) {
  // Signed in, looking at their own photos.
  const subject = await requireSelf("photos.delete_own", "/app/photos");
  const query = await searchParams;
  const league = await currentLeague(db);
  if (!league || !can(subject, "photos.upload"))
    return (
      <p>
        Photos come from players on a team. Once you&apos;re on a roster, you
        can share yours here.
      </p>
    );
  const now = new Date();
  const [targets, mine, storage] = await Promise.all([
    uploadTargets(db, { leagueId: league.id, userId: subject.userId, now }),
    myPhotos(db, subject.userId),
    photoStorage(db, league.id),
  ]);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: league.timeZone,
  });
  const games = targets.games.map((g) => ({
    value: g.id,
    label: `${day.format(g.startsAt)}: ${g.teamA} vs ${g.teamB}`,
  }));
  const events = targets.events.map((e) => ({
    value: e.id,
    label: `${e.title} (${day.format(e.startsAt)})`,
  }));
  const teams = targets.teams.map((t) => ({ value: t.id, label: t.name }));
  // A link from a public page can choose for them.
  const game = targets.games.find((g) => g.id === first(query.game));
  const event = targets.events.find((e) => e.slug === first(query.event));
  const team =
    targets.teams.find((t) => t.slug === first(query.team)) ??
    targets.teams.find((t) => t.id === game?.teamId) ??
    (targets.teams.length === 1 ? targets.teams[0] : undefined);
  const nothingToTag =
    games.length === 0 && events.length === 0 && teams.length === 0;

  return (
    <>
      {first(query.done) === "deleted" && (
        <p role="status" className="font-bold">
          Photo deleted.
        </p>
      )}
      {leagueStorageFull(storage.usedBytes) ? (
        <p role="status" className="rounded-card border-2 border-warning p-4">
          {UPLOAD_MESSAGES.league_full}
        </p>
      ) : nothingToTag ? (
        <p className="text-text-muted">
          There&apos;s nothing to tag a photo to right now: no game days in the
          last month and no recent events. Check back after your next game.
        </p>
      ) : (
        <UploadForm
          action={uploadPhotoAction}
          games={games}
          events={events}
          teams={teams}
          defaults={{
            game: game?.id ?? "",
            event: event?.id ?? "",
            team: team?.id ?? "",
          }}
        />
      )}

      <section aria-labelledby="mine" className="flex flex-col gap-3">
        <h2 id="mine" className="text-h2">
          Your photos
        </h2>
        {mine.length === 0 ? (
          <p className="text-text-muted">
            Nothing yet. Photos you send show here with what the league decided.
            You can delete any of them at any time.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {mine.map((p) => (
              <li key={p.id} className="flex flex-col gap-2">
                <MyPhoto photo={p} />
                <p className="text-small font-bold">{STATUS[p.status]}</p>
                <p className="text-small text-text-muted">
                  {[p.teamName, p.eventTitle, p.gameId ? "Game day" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <form action={deleteMyPhotoAction}>
                  <input type="hidden" name="photo" value={p.id} />
                  <SubmitButton className="btn btn-secondary">
                    Delete
                    <span className="sr-only">
                      {" "}
                      the photo sent {day.format(p.createdAt)}
                    </span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The stored copy, from the private route; a rejected one has none left. */
function MyPhoto({ photo }: { photo: ListedPhoto }) {
  if (photo.status === "rejected")
    return (
      <div className="flex aspect-square items-center justify-center rounded-card border border-border bg-surface-2 p-2 text-center text-small text-text-muted">
        Deleted after review
      </div>
    );
  return (
    // A private, signed-in copy the image optimizer can't fetch, so a plain
    // img with its size, loaded lazily.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/app/photos/${photo.id}`}
      alt={photo.caption ?? "Your photo"}
      width={photo.width}
      height={photo.height}
      loading="lazy"
      decoding="async"
      className="aspect-square w-full rounded-card border border-border object-cover"
    />
  );
}
