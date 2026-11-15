import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { remindedCount, shirtOrderBoard } from "@/db/queries/shirt-order";
import { can } from "@/domain/authz/permissions";
import { merchSizeLabel } from "@/domain/merch/catalog";
import { formatCents } from "@/domain/registration/pricing";
import {
  countSizes,
  NO_TEAM,
  ORDER_FORM_ERRORS,
  ORDER_STATUS_LABEL,
  type SizeCounts,
  seasonSize,
} from "@/domain/shirts/order";
import {
  SHIRT_SIZES,
  type ShirtSize,
  sizeLabel,
} from "@/domain/shirts/summary";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth/permission";
import {
  addToBooksAction,
  placeOrderAction,
  receiveOrderAction,
  remindSizesAction,
  setSizesAction,
} from "./actions";
import { activeLeagueId } from "@/lib/league/active";

export const metadata: Metadata = { title: "Shirt order" };

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

const SAVED: Record<string, string> = {
  sizes: "Sizes saved. Sign-up forms offer these now.",
  placed: "Order saved as placed. Players with a size are marked ordered.",
  received: "Order received. Every ordered shirt is marked received.",
  books: "Added to the books as a shirts expense.",
};

const ERRORS: Record<string, string> = {
  ...ORDER_FORM_ERRORS,
  no_sizes: "Offer at least one size.",
  not_placed: "Mark the order placed first.",
  already_received: "This order is already received.",
  no_cost: "Enter what the order cost first.",
  already_in_books: "This order is already in the books.",
  unknown_season: "That season is not in this league.",
  in_books:
    "The cost is already in the books. Correct it there, or keep this cost.",
  order_placed:
    "The order is placed, so the sizes stay as they were when it was counted.",
};

export default function ShirtOrderPage(
  props: PageProps<"/app/admin/seasons/[season]/shirt-order">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <ShirtOrder {...props} />
      </Suspense>
    </main>
  );
}

function Swatch({ color }: { color: string | null }) {
  return color ? (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full border border-border-strong"
      style={{ background: color }}
    />
  ) : null;
}

function CountsRow({
  label,
  color,
  counts,
  sizes,
  strong = false,
}: {
  label: string;
  color: string | null;
  counts: SizeCounts;
  sizes: readonly ShirtSize[];
  strong?: boolean;
}) {
  const Cell = strong ? "th" : "td";
  return (
    <tr className="border-t border-border">
      <th scope="row" className="py-2 pr-2 font-normal">
        <span className="inline-flex items-center gap-2">
          <Swatch color={color} />
          {label}
        </span>
      </th>
      {sizes.map((s) => (
        <Cell key={s} className="tabular-nums">
          {counts.bySize[s] ?? "–"}
        </Cell>
      ))}
      <Cell className="tabular-nums">{counts.missing || "–"}</Cell>
      <Cell className="tabular-nums">{counts.total - counts.missing}</Cell>
    </tr>
  );
}

const day = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(at);

async function ShirtOrder({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/shirt-order">) {
  const { season: slug } = await params;
  const page = `/app/admin/seasons/${slug}/shirt-order`;
  const subject = await requirePermission("shirts.manage", { next: page });
  const query = await searchParams;
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const [board, reminded] = await Promise.all([
    shirtOrderBoard(db, season.id),
    remindedCount(db, season.id),
  ]);
  const { settings } = board;
  const sizes = settings.sizes;
  const groups = [
    ...board.teams.map((t) => ({
      key: t.teamSeasonId,
      name: t.name,
      color: t.colorHex,
      players: t.players,
    })),
    ...(board.freeAgents.length > 0
      ? [
          {
            key: "unplaced",
            name: NO_TEAM,
            color: null,
            players: board.freeAgents,
          },
        ]
      : []),
  ];
  const everyone = groups.flatMap((g) => g.players);
  const league = countSizes(everyone, sizes);
  const missing = groups.flatMap((g) =>
    g.players
      .filter((p) => seasonSize(p.size, sizes) === null)
      .map((p) => ({ ...p, team: g.name })),
  );
  const jerseys = new Map<
    string,
    { team: string; color: string | null; bySize: Map<string, number> }
  >();
  for (const j of board.jerseys) {
    const key = `${j.teamName ?? ""}/${j.colorHex ?? ""}`;
    const entry = jerseys.get(key) ?? {
      team: j.teamName ?? NO_TEAM,
      color: j.colorHex,
      bySize: new Map<string, number>(),
    };
    const label = merchSizeLabel(j.size);
    entry.bySize.set(label, (entry.bySize.get(label) ?? 0) + j.quantity);
    jerseys.set(key, entry);
  }
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : null;
  const error = typeof query.error === "string" ? ERRORS[query.error] : null;
  const remindedNow =
    typeof query.reminded === "string" ? Number(query.reminded) : null;
  const booksAllowed = can(subject, "books.manage");

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {season.name}
        </Link>
        <h1 className="text-h1">Shirt order</h1>
        <p className="text-text-muted">
          {everyone.length} players · {league.total - league.missing} with a
          size · {league.missing} without one
        </p>
        <p>
          <Link
            href={`/app/admin/seasons/${slug}/shirts`}
            className="underline"
          >
            Each player&apos;s shirt: ordered and received
          </Link>
        </p>
      </header>

      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {remindedNow !== null && Number.isInteger(remindedNow) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {remindedNow === 0
            ? "Nobody new to remind: everyone without a size has had a reminder."
            : remindedNow === 1
              ? "Reminded 1 player to pick a size."
              : `Reminded ${remindedNow} players to pick a size.`}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      <section
        id="order"
        aria-labelledby="order-heading"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="order-heading" className="text-h2">
          The order: {ORDER_STATUS_LABEL[settings.status]}
        </h2>
        {settings.placedAt && (
          <p>
            Placed {day(settings.placedAt, season.timeZone)}
            {settings.vendor ? ` with ${settings.vendor}` : ""}
            {settings.costCents !== null
              ? ` for ${formatCents(settings.costCents)}`
              : ""}
            .
            {settings.receivedAt &&
              ` Received ${day(settings.receivedAt, season.timeZone)}.`}
          </p>
        )}
        {settings.status !== "received" && (
          <form
            action={placeOrderAction.bind(null, slug)}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="cost" className="font-bold">
                Cost in dollars (optional)
              </label>
              <input
                id="cost"
                name="cost"
                inputMode="decimal"
                defaultValue={
                  settings.costCents !== null
                    ? (settings.costCents / 100).toFixed(2)
                    : ""
                }
                readOnly={settings.expenseId !== null}
                aria-describedby={
                  settings.expenseId !== null ? "cost-in-books" : undefined
                }
                className={`${control} w-36`}
              />
              {settings.expenseId !== null && (
                <p id="cost-in-books" className="text-small text-text-muted">
                  In the books; correct it there.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="vendor" className="font-bold">
                Vendor (optional)
              </label>
              <input
                id="vendor"
                name="vendor"
                maxLength={80}
                defaultValue={settings.vendor ?? ""}
                className={`${control} w-56`}
              />
            </div>
            <SubmitButton className="btn btn-primary">
              {settings.status === "not_placed"
                ? "Mark the order placed"
                : "Save the cost and vendor"}
            </SubmitButton>
          </form>
        )}
        {settings.status === "placed" && (
          <form action={receiveOrderAction.bind(null, slug)}>
            <SubmitButton className="btn btn-secondary">
              Mark the order received
            </SubmitButton>
          </form>
        )}
        {settings.status !== "not_placed" &&
          settings.costCents !== null &&
          (settings.expenseId ? (
            <p className="text-text-muted">In the books as a shirts expense.</p>
          ) : booksAllowed ? (
            <form action={addToBooksAction.bind(null, slug)}>
              <SubmitButton className="btn btn-secondary">
                Add {formatCents(settings.costCents)} to the books
              </SubmitButton>
            </form>
          ) : (
            <p className="text-text-muted">
              An owner can add the cost to the books from this screen.
            </p>
          ))}
        <form
          method="get"
          action={`${page}/order.csv`}
          className="flex flex-wrap items-center gap-3"
        >
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="names"
              value="1"
              className="size-5 accent-brand"
            />
            Include names for team packing
          </label>
          <SubmitButton className="btn btn-secondary">
            Download for the vendor (CSV)
          </SubmitButton>
        </form>
        <p className="text-small text-text-muted">
          Sizes and counts by team and color. Names are left out unless you tick
          the box.
        </p>
      </section>

      <section aria-labelledby="counts" className="flex flex-col gap-3">
        <h2 id="counts" className="text-h2">
          Sizes
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left">
            <thead className="text-text-muted">
              <tr>
                <th scope="col">Team</th>
                {sizes.map((s) => (
                  <th key={s} scope="col">
                    {sizeLabel(s)}
                  </th>
                ))}
                <th scope="col">No size</th>
                <th scope="col">Shirts</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <CountsRow
                  key={g.key}
                  label={g.name}
                  color={g.color}
                  counts={countSizes(g.players, sizes)}
                  sizes={sizes}
                />
              ))}
            </tbody>
            <tfoot className="font-bold">
              <CountsRow
                label="Whole league"
                color={null}
                counts={league}
                sizes={sizes}
                strong
              />
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-labelledby="jerseys" className="flex flex-col gap-3">
        <h2 id="jerseys" className="text-h2">
          Replacement jerseys to make
        </h2>
        {jerseys.size === 0 ? (
          <p className="text-text-muted">
            None paid for this season&apos;s teams. They come from the{" "}
            <Link href="/app/admin/merch" className="underline">
              league shop
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...jerseys.values()].map((j) => (
              <li
                key={`${j.team}/${j.color}`}
                className="flex items-center gap-2"
              >
                <Swatch color={j.color} />
                <span className="font-bold">{j.team}:</span>{" "}
                {[...j.bySize.entries()]
                  .map(([size, n]) => `${n} ${size}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id="missing"
        aria-labelledby="missing-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="missing-heading" className="text-h2">
          Without a size ({missing.length})
        </h2>
        {missing.length === 0 ? (
          <p className="text-text-muted">Everyone has a size.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {missing.map((p) => (
                <li key={p.registrationId}>
                  {p.name}{" "}
                  <span className="text-small text-text-muted">({p.team})</span>
                </li>
              ))}
            </ul>
            <form action={remindSizesAction.bind(null, slug)}>
              <SubmitButton className="btn btn-secondary">
                Remind them to pick a size
              </SubmitButton>
            </form>
            <p className="text-small text-text-muted">
              One email each, never more. {reminded} reminded so far.
            </p>
          </>
        )}
      </section>

      <section
        id="sizes"
        aria-labelledby="sizes-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="sizes-heading" className="text-h2">
          Sizes offered this season
        </h2>
        <form
          action={setSizesAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <fieldset
            disabled={settings.status !== "not_placed"}
            className="flex flex-wrap gap-2"
          >
            <legend className="sr-only">Sizes offered</legend>
            {SHIRT_SIZES.map((s) => (
              <label
                key={s}
                className="flex min-h-11 items-center gap-2 rounded-input border border-border-strong px-3"
              >
                <input
                  type="checkbox"
                  name="size"
                  value={s}
                  defaultChecked={sizes.includes(s)}
                  className="size-5 accent-brand"
                />
                {sizeLabel(s)}
              </label>
            ))}
          </fieldset>
          {settings.status === "not_placed" ? (
            <>
              <SubmitButton className="btn self-start btn-secondary">
                Save sizes
              </SubmitButton>
              <p className="text-small text-text-muted">
                Sign-up forms offer only these. A player whose size isn&apos;t
                offered is listed above as without one.
              </p>
            </>
          ) : (
            <p className="text-small text-text-muted">
              The order is placed, so these sizes are set for the season.
            </p>
          )}
        </form>
      </section>
    </>
  );
}
