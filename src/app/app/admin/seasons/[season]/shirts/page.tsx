import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type ShirtPlayer, shirtBoard } from "@/db/queries/shirts";
import {
  countShirts,
  SHIRT_SIZES,
  SHIRT_STATUS_LABEL,
  SHIRT_STATUSES,
  type ShirtCounts,
  sizeLabel,
} from "@/domain/shirts/summary";
import { requirePermission } from "@/lib/auth/permission";
import { markTeamOrderedAction, setShirtStatusAction } from "./actions";

export const metadata: Metadata = { title: "Shirts" };

export default function ShirtsPage(
  props: PageProps<"/app/admin/seasons/[season]/shirts">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Shirts {...props} />
      </Suspense>
    </main>
  );
}

const NOTICES: Record<string, string> = {
  saved: "Shirt status saved.",
  ordered: "Shirts marked as ordered.",
};

/** One row of the sizes table. */
function CountsRow({
  label,
  counts,
  strong = false,
}: {
  label: ReactNode;
  counts: ShirtCounts;
  strong?: boolean;
}) {
  const Cell = strong ? "th" : "td";
  return (
    <tr className="border-t border-border">
      <th scope="row" className="py-2 pr-2 font-normal">
        {label}
      </th>
      {SHIRT_SIZES.map((size) => (
        <Cell key={size} className="tabular-nums">
          {counts.bySize[size] || "–"}
        </Cell>
      ))}
      <Cell className="tabular-nums">{counts.unknown || "–"}</Cell>
      <Cell className="tabular-nums">{counts.total}</Cell>
      <Cell className="tabular-nums">
        {counts.received} of {counts.total}
      </Cell>
    </tr>
  );
}

function StatusButtons({
  slug,
  player,
}: {
  slug: string;
  player: ShirtPlayer;
}) {
  return (
    <form
      action={setShirtStatusAction.bind(null, slug, player.registrationId)}
      className="flex flex-wrap gap-1"
      aria-label={`Shirt status for ${player.name}`}
    >
      {SHIRT_STATUSES.map((status) => (
        <button
          key={status}
          type="submit"
          name="status"
          value={status}
          aria-pressed={player.status === status}
          className={`rounded-full border px-3 py-0.5 text-small ${
            player.status === status
              ? "border-text bg-text text-surface"
              : "border-border"
          }`}
        >
          {SHIRT_STATUS_LABEL[status]}
        </button>
      ))}
    </form>
  );
}

function PlayerTable({
  slug,
  players,
}: {
  slug: string;
  players: ShirtPlayer[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-left">
        <thead className="text-text-muted">
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Size</th>
            <th scope="col">Shirt</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.registrationId}
              id={`player-${p.registrationId}`}
              className="border-t border-border"
            >
              <td className="py-2 pr-2">{p.name}</td>
              <td className={p.size ? "" : "text-text-muted"}>
                {sizeLabel(p.size)}
              </td>
              <td className="py-1">
                <StatusButtons slug={slug} player={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Shirts({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/shirts">) {
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("shirts.manage", {
    next: `/app/admin/seasons/${slug}/shirts`,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const board = await shirtBoard(db, season.id);
  const everyone = [
    ...board.teams.flatMap((t) => t.players),
    ...board.freeAgents,
  ];
  const all = countShirts(everyone);
  const toOrder = SHIRT_SIZES.filter((s) => all.toOrder[s] > 0);
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          {season.name}
        </Link>
        <h1 className="text-h1">Shirts</h1>
        <p className="text-text-muted">
          {all.total} players · {all.ordered} ordered · {all.received} received
          · {all.unknown} with no size on their profile
        </p>
        <p>
          <a
            href={`/app/seasons/${slug}/export/roster.csv`}
            download
            className="underline"
          >
            Download the roster with shirt sizes (CSV)
          </a>
        </p>
      </header>
      {query.error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          That player is not registered for this season.
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}

      <section aria-labelledby="sizes" className="flex flex-col gap-3">
        <h2 id="sizes" className="text-h2">
          Sizes by team
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="text-text-muted">
              <tr>
                <th scope="col">Team</th>
                {SHIRT_SIZES.map((s) => (
                  <th key={s} scope="col">
                    {sizeLabel(s)}
                  </th>
                ))}
                <th scope="col">No size</th>
                <th scope="col">Total</th>
                <th scope="col">Received</th>
              </tr>
            </thead>
            <tbody>
              {board.teams.map((t) => (
                <CountsRow
                  key={t.teamSeasonId}
                  label={
                    <a href={`#team-${t.teamSeasonId}`} className="underline">
                      {t.name}
                    </a>
                  }
                  counts={countShirts(t.players)}
                />
              ))}
              {board.freeAgents.length > 0 && (
                <CountsRow
                  label="Free agents"
                  counts={countShirts(board.freeAgents)}
                />
              )}
            </tbody>
            <tfoot className="font-bold">
              <CountsRow label="All players" counts={all} strong />
            </tfoot>
          </table>
        </div>
        <p>
          <strong>Still to order:</strong>{" "}
          {toOrder.length === 0 && all.toOrderUnknown === 0
            ? "nothing. Every player's shirt is ordered."
            : [
                ...toOrder.map((s) => `${all.toOrder[s]} ${sizeLabel(s)}`),
                ...(all.toOrderUnknown > 0
                  ? [`${all.toOrderUnknown} with no size yet`]
                  : []),
              ].join(", ")}
        </p>
      </section>

      <section aria-labelledby="players" className="flex flex-col gap-6">
        <h2 id="players" className="text-h2">
          Players
        </h2>
        {board.teams.length === 0 && board.freeAgents.length === 0 && (
          <p className="text-text-muted">Nobody has registered yet.</p>
        )}
        {board.teams.map((t) => {
          const waiting = t.players.filter((p) => p.status === "none").length;
          return (
            <article
              key={t.teamSeasonId}
              id={`team-${t.teamSeasonId}`}
              aria-label={t.name}
              className="flex flex-col gap-2 rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-h3">
                  {t.colorHex && (
                    <span
                      aria-hidden="true"
                      className="inline-block size-4 rounded-full border border-border"
                      style={{ background: t.colorHex }}
                    />
                  )}
                  {t.name}
                </h3>
                {waiting > 0 && (
                  <form
                    action={markTeamOrderedAction.bind(
                      null,
                      slug,
                      t.teamSeasonId,
                    )}
                  >
                    <button type="submit" className="underline">
                      Mark {waiting} unordered{" "}
                      {waiting === 1 ? "shirt" : "shirts"} as ordered
                    </button>
                  </form>
                )}
              </div>
              <PlayerTable slug={slug} players={t.players} />
            </article>
          );
        })}
        {board.freeAgents.length > 0 && (
          <article
            aria-label="Free agents"
            className="flex flex-col gap-2 rounded-lg border border-border p-4"
          >
            <h3 className="text-h3">Free agents</h3>
            <PlayerTable slug={slug} players={board.freeAgents} />
          </article>
        )}
      </section>
    </>
  );
}
