import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { boroughName } from "@/domain/capacity/nearby";
import { packetText } from "@/domain/permits/packet";
import { PageLoading } from "@/components/page-loading";
import { requirePermission } from "@/lib/auth/permission";
import { CopySheet } from "../../../copy-sheet";
import { booksSeason } from "../../../load";
import { loadPacket, wantsNames } from "./load";

export const metadata: Metadata = { title: "Permit application packet" };

export default function PacketPage(
  props: PageProps<"/app/books/[season]/permits/packet">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Packet {...props} />
      </Suspense>
    </main>
  );
}

async function Packet({
  params,
  searchParams,
}: PageProps<"/app/books/[season]/permits/packet">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}/permits/packet`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season } = await booksSeason(slug);
  const loaded = await loadPacket(league, season, query);
  const { packet } = loaded;
  const text = packetText(packet, boroughName);
  const names = wantsNames(query);
  const hidden = Object.entries(query).flatMap(([name, value]) =>
    name === "names"
      ? []
      : (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(
          (v) => ({ name, value: v }),
        ),
  );

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/books/${slug}/permits`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Permits: {season.name}
        </Link>
        <h1 className="text-h1">Permit application packet</h1>
        <p className="text-text-muted">
          What NYC Parks may ask for, in one place. Copy it into the application
          or download it. Nothing is sent to Parks from here.
        </p>
      </header>

      <section aria-labelledby="league" className="flex flex-col gap-2">
        <h2 id="league" className="text-h2">
          The league
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-text-muted">Name</dt>
          <dd>{packet.league}</dd>
          <dt className="text-text-muted">Website</dt>
          <dd className="break-all">
            <a href={packet.website} className="underline">
              {packet.website}
            </a>
          </dd>
          <dt className="text-text-muted">Season</dt>
          <dd>
            {season.name}, {season.startsOn} to {season.endsOn}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="counts" className="flex flex-col gap-2">
        <h2 id="counts" className="text-h2">
          Schedule and rosters
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-text-muted">Teams</dt>
          <dd>{packet.counts.teams}</dd>
          <dt className="text-text-muted">Players on rosters</dt>
          <dd>{packet.counts.players}</dd>
          <dt className="text-text-muted">Games scheduled</dt>
          <dd>
            {packet.counts.games} on {packet.counts.gameDays}{" "}
            {packet.counts.gameDays === 1 ? "day" : "days"}
          </dd>
        </dl>
        <form method="get" action={page} className="flex flex-col gap-2">
          {hidden.map((h, i) => (
            <input key={i} type="hidden" name={h.name} value={h.value} />
          ))}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="names"
              value="1"
              defaultChecked={names}
              className="size-5"
            />
            Include the rosters with player names
          </label>
          <p className="text-small text-text-muted">
            Off unless you choose it: Parks may ask for rosters, but the counts
            are often enough. Names only, never contact details.
          </p>
          <button type="submit" className="btn self-start btn-secondary">
            Update the packet
          </button>
        </form>
        {packet.rosters && (
          <ul className="flex flex-col gap-2">
            {packet.rosters.map((t) => (
              <li key={t.team}>
                <strong>{t.team}</strong> ({t.players.length}):{" "}
                {t.players.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="applications" className="flex flex-col gap-3">
        <h2 id="applications" className="text-h2">
          Applications by borough
        </h2>
        <p className="text-text-muted">
          From the request sheet on the permits screen, one application per
          borough.{" "}
          <Link
            href={`/app/books/${slug}/permits?${loaded.query}#request`}
            className="underline"
          >
            Change the sheet
          </Link>
          .
        </p>
        {!loaded.namedFields && (
          <p role="status" className="rounded-lg border border-warning p-3">
            Pick the fields on the request sheet so each booking names its field
            and lands in its borough&apos;s application.
          </p>
        )}
        {packet.applications.length === 0 ? (
          <p className="text-text-muted">
            The request sheet has nothing to ask for yet.
          </p>
        ) : (
          packet.applications.map((a) => (
            <div key={a.borough ?? "unknown"} className="flex flex-col gap-1">
              <h3 className="text-h3">
                {a.borough ? boroughName(a.borough) : "Borough not known"}
              </h3>
              <p>
                {a.rows.length} {a.rows.length === 1 ? "booking" : "bookings"},
                from {a.rows[0]?.date} to {a.rows.at(-1)?.date}
              </p>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="insurance" className="flex flex-col gap-2">
        <h2 id="insurance" className="text-h2">
          Insurance
        </h2>
        {loaded.certificate ? (
          <p>
            {loaded.certificate.insurer}
            {loaded.certificate.policyNumber
              ? `, policy ${loaded.certificate.policyNumber}`
              : ""}
            : {loaded.certificate.startsOn} to {loaded.certificate.expiresOn}.
            {loaded.certificate.documentFileId && (
              <>
                {" "}
                <a
                  href={`/app/books/files/${loaded.certificate.documentFileId}`}
                  className="underline"
                >
                  Open the certificate
                </a>
              </>
            )}
          </p>
        ) : (
          <p className="text-text-muted">
            No certificate on file. Add one on the permits screen.
          </p>
        )}
      </section>

      <section aria-labelledby="whole" className="flex flex-col gap-3">
        <h2 id="whole" className="text-h2">
          The whole packet
        </h2>
        <CopySheet text={text} label="Copy the packet" />
        <a
          href={`/app/books/${slug}/permits/packet/packet.txt?${loaded.query}`}
          className="btn self-start btn-secondary"
          download
        >
          Download the packet (text)
        </a>
        <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-small whitespace-pre-wrap">
          {text}
        </pre>
      </section>
    </>
  );
}
