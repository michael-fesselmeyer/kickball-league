import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { type BoardItem, board } from "@/db/queries/lost-found";
import { daysLeft } from "@/domain/lost-found/rules";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Lost and found" };

export default function LostAndFoundPage(
  props: PageProps<"/[lang]/app/lost-and-found">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Home
        </Link>
        <h1 className="text-h1">Lost and found</h1>
        <p className="text-text-muted">
          Found something at the field or the bar? Lost something? Post it here.
          Members only; nobody&apos;s phone or email is shown, you talk in the
          app.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/app/lost-and-found/new?kind=found"
            className="btn btn-primary"
          >
            I found something
          </Link>
          <Link
            href="/app/lost-and-found/new?kind=lost"
            className="btn btn-secondary"
          >
            I lost something
          </Link>
        </div>
      </header>
      <Suspense fallback={<PageLoading>Loading the board…</PageLoading>}>
        <Board {...props} />
      </Suspense>
    </main>
  );
}

const DONE: Record<string, string> = {
  closed: "Post closed.",
  removed: "Post taken down.",
};

async function Board({
  searchParams,
}: PageProps<"/[lang]/app/lost-and-found">) {
  const subject = await requirePermission("lost_found.use", {
    next: "/app/lost-and-found",
  });
  const league = await activeLeague();
  if (!league) return <p>There&apos;s no league to show a board for.</p>;
  const query = await searchParams;
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const { found, lost } = await board(db, {
    leagueId: league.id,
    viewerId: subject.userId,
  });
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: league.timeZone,
  });
  return (
    <>
      {done && (
        <p role="status" className="font-bold">
          {done}
        </p>
      )}
      <Section
        id="found"
        title="Found"
        empty="Nothing has been found lately."
        items={found}
        day={day}
        now={now}
      />
      <Section
        id="lost"
        title="Lost"
        empty="Nobody is looking for anything right now."
        items={lost}
        day={day}
        now={now}
      />
    </>
  );
}

function Section({
  id,
  title,
  empty,
  items,
  day,
  now,
}: {
  id: string;
  title: string;
  empty: string;
  items: BoardItem[];
  day: Intl.DateTimeFormat;
  now: Date;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex gap-3 rounded-card border-2 border-text bg-surface p-3 shadow-sticker"
            >
              {i.hasPhoto && (
                // A private, signed-in thumbnail the image optimizer can't
                // fetch: a plain img with its size, loaded lazily.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/app/lost-and-found/${i.id}/photo?size=thumb`}
                  alt=""
                  width={96}
                  height={96}
                  loading="lazy"
                  decoding="async"
                  className="size-24 shrink-0 rounded-card border border-border object-cover"
                />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <Link
                  href={`/app/lost-and-found/${i.id}`}
                  className="min-h-11 font-bold underline"
                >
                  {i.description}
                </Link>
                <p className="text-small text-text-muted">
                  {i.kind === "found" ? "Found at" : "Lost at"} {i.place}
                  {i.whereNow ? ` · Now: ${i.whereNow}` : ""}
                </p>
                <p className="text-small text-text-muted">
                  {i.mine ? "Your post" : i.posterName} ·{" "}
                  {day.format(i.postedAt)} · {daysLeft(i.postedAt, now)} days
                  left
                  {i.mine && i.openClaims > 0
                    ? ` · ${i.openClaims} ${i.openClaims === 1 ? "answer" : "answers"} waiting`
                    : ""}
                  {i.answered ? " · You answered" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
