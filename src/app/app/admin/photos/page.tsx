import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  photoStorage,
  type QueuedPhoto,
  reviewQueue,
} from "@/db/queries/member-photos";
import { currentLeague } from "@/db/queries/seasons";
import {
  LEAGUE_CAP_BYTES,
  leagueStorageFull,
  NOTE_MAX,
} from "@/domain/member-photos/limits";
import { requirePermission } from "@/lib/auth/permission";
import { deletePhotoAction, reviewPhotoAction } from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Member photos" };

export default function AdminPhotosPage(props: PageProps<"/app/admin/photos">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Member photos</h1>
        <p className="text-text-muted">
          Photos players sent for the league&apos;s socials, each with their OK
          to repost it. Approved photos show on the team, event or game page
          they were tagged to. Download one to post it on Instagram.
        </p>
      </header>
      <Suspense fallback={<PageLoading>Loading photos…</PageLoading>}>
        <Queue {...props} />
      </Suspense>
    </main>
  );
}

const DONE: Record<string, string> = {
  approved: "Approved. It's on its pages now, and the player has been told.",
  rejected:
    "Rejected and deleted. The player has been told, without your note.",
  deleted: "Photo deleted from the site.",
};

const ERROR: Record<string, string> = {
  not_found: "That photo is gone: its player may have deleted it.",
  already_reviewed: "Another admin already reviewed that photo.",
};

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

async function Queue({ searchParams }: PageProps<"/app/admin/photos">) {
  await requirePermission("photos.manage", { next: "/app/admin/photos" });
  const query = await searchParams;
  const league = await currentLeague(db);
  if (!league) return <p>No league is set up yet.</p>;
  const [queue, storage] = await Promise.all([
    reviewQueue(db, league.id),
    photoStorage(db, league.id),
  ]);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: league.timeZone,
  });
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const error =
    typeof query.error === "string" ? ERROR[query.error] : undefined;
  const full = leagueStorageFull(storage.usedBytes);

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
      <p
        className={
          full ? "rounded-card border-2 border-warning p-3" : "text-text-muted"
        }
      >
        Storage: {mb(storage.usedBytes)} MB of{" "}
        {Math.round(LEAGUE_CAP_BYTES / (1024 * 1024))} MB used.{" "}
        {full
          ? "Uploads are closed until you delete older photos (download any you want to keep first)."
          : "Rejected photos are deleted at once; delete approved ones you no longer need to make room."}
      </p>

      <section aria-labelledby="waiting" className="flex flex-col gap-4">
        <h2 id="waiting" className="text-h2">
          Waiting for review ({storage.pending})
        </h2>
        {queue.pending.length === 0 ? (
          <p className="text-text-muted">All caught up.</p>
        ) : (
          <ul className="grid gap-6 md:grid-cols-2">
            {queue.pending.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-3 rounded-card border-2 border-text bg-surface p-4"
              >
                <Thumb photo={p} />
                <About photo={p} when={day.format(p.createdAt)} />
                <div className="flex flex-wrap items-start gap-2">
                  <form action={reviewPhotoAction}>
                    <input type="hidden" name="photo" value={p.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <SubmitButton className="btn btn-primary">
                      Approve
                    </SubmitButton>
                  </form>
                  <Download photo={p} />
                </div>
                <form
                  action={reviewPhotoAction}
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="photo" value={p.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <label className="flex flex-col gap-1 text-small">
                    Note for admins (optional, never shown to the player)
                    <textarea
                      name="note"
                      rows={2}
                      maxLength={NOTE_MAX}
                      className="rounded-input border border-border-strong bg-bg px-3 py-2"
                    />
                  </label>
                  <SubmitButton className="btn self-start btn-secondary">
                    Reject and delete
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="approved" className="flex flex-col gap-4">
        <h2 id="approved" className="text-h2">
          Approved
        </h2>
        {queue.approved.length === 0 ? (
          <p className="text-text-muted">No approved photos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {queue.approved.map((p) => (
              <li key={p.id} className="flex flex-col gap-2">
                <Thumb photo={p} />
                <About photo={p} when={day.format(p.createdAt)} />
                <Download photo={p} />
                <form action={deletePhotoAction}>
                  <input type="hidden" name="photo" value={p.id} />
                  <SubmitButton className="btn btn-secondary">
                    Take down
                    <span className="sr-only"> this photo</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {queue.rejected.length > 0 && (
        <section aria-labelledby="rejected" className="flex flex-col gap-3">
          <h2 id="rejected" className="text-h2">
            Recently rejected
          </h2>
          <ul className="flex flex-col gap-2">
            {queue.rejected.map((p) => (
              <li key={p.id} className="text-small">
                {p.uploaderName ?? "A player"}, sent {day.format(p.createdAt)}
                {p.reviewNote ? `: ${p.reviewNote}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The stored copy from the private route, holding its shape while it loads. */
function Thumb({ photo }: { photo: QueuedPhoto }) {
  return (
    // Private copies the image optimizer can't fetch: a plain img, lazily.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/app/photos/${photo.id}`}
      alt={photo.caption ?? "A member's photo"}
      width={photo.width}
      height={photo.height}
      loading="lazy"
      decoding="async"
      className="aspect-[4/3] w-full rounded-card border border-border bg-surface-2 object-contain"
    />
  );
}

function About({ photo, when }: { photo: QueuedPhoto; when: string }) {
  const tags = [
    photo.teamName,
    photo.eventTitle,
    photo.gameId ? "a game day" : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1 text-small">
      {photo.caption && <p className="text-body">{photo.caption}</p>}
      <p className="text-text-muted">
        From {photo.uploaderName ?? "a player"}, {when}
        {tags.length > 0 ? ` · ${tags.join(", ")}` : ""}
      </p>
      {photo.gameId && (
        <Link href={`/games/${photo.gameId}`} className="underline">
          The game
        </Link>
      )}
    </div>
  );
}

function Download({ photo }: { photo: QueuedPhoto }) {
  return (
    <a
      href={`/app/photos/${photo.id}?download`}
      download
      className="btn btn-secondary"
    >
      Download
      <span className="sr-only"> this photo</span>
    </a>
  );
}
