import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WaiverText } from "@/components/waiver-text";
import { db } from "@/db/client";
import { profileOf } from "@/db/queries/profile";
import { ageMessage, underAge } from "@/domain/registration/age";
import { localDay } from "@/domain/schedule/public-game";
import { conductForPerson } from "@/db/queries/conduct";
import { waiverForSeason } from "@/db/queries/waivers";
import { requireSelf } from "@/lib/auth/permission";
import { signWaiverAction } from "./actions";
import { SignWaiverForm } from "./sign-form";
import { PageLoading } from "@/components/page-loading";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Season waiver" };

export default function WaiverPage(
  props: PageProps<"/[lang]/app/seasons/[season]/waiver">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the waiver…</PageLoading>}>
        <Waiver {...props} />
      </Suspense>
    </main>
  );
}

async function Waiver({
  params,
  searchParams,
}: PageProps<"/[lang]/app/seasons/[season]/waiver">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requireSelf(
    "waiver.sign",
    `/app/seasons/${slug}/waiver`,
  );
  const league = await activeLeague();
  const view = league
    ? await waiverForSeason(db, {
        leagueId: league.id,
        slug,
        userId: subject.userId,
      })
    : null;
  if (!view) notFound();
  const [person, conduct] = await Promise.all([
    profileOf(db, subject.userId),
    league ? conductForPerson(db, league.id, subject.userId) : null,
  ]);
  // Asked once per version: someone who accepted this one is not asked again.
  const askConduct = conduct && !conduct.acceptedAt ? conduct.code : null;
  const fullName =
    person?.firstName && person.lastName
      ? `${person.firstName} ${person.lastName}`
      : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{view.seasonName}</p>
        <h1 className="text-h1">Waiver</h1>
      </header>
      {!view.waiverId || !view.bodyMd || !view.bodySha256 ? (
        <p>This season has no waiver yet. Check back soon.</p>
      ) : (
        <>
          {view.signature ? (
            <>
              <p role="status" className="rounded-lg border border-success p-3">
                {query.signed ? "Signed. " : ""}You signed version{" "}
                {view.version} as <strong>{view.signature.signedName}</strong>{" "}
                on{" "}
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "long",
                  timeStyle: "short",
                  timeZone: league?.timeZone,
                }).format(view.signature.signedAt)}
                .
              </p>
              <Link href={`/app/seasons/${slug}`} className="btn btn-primary">
                Next: back to {view.seasonName}
              </Link>
            </>
          ) : (
            <p>
              Read the whole waiver, then sign at the bottom. You sign once a
              season, and again only if the league changes the text.
            </p>
          )}
          <article
            aria-labelledby="waiver-title"
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <h2 id="waiver-title" className="text-h2">
              {view.title}{" "}
              <span className="text-small text-text-muted">
                version {view.version}
              </span>
            </h2>
            <WaiverText body={view.bodyMd} />
          </article>
          {!view.signature && askConduct && (
            <article
              aria-labelledby="conduct-title"
              className="flex flex-col gap-3 rounded-lg border border-border p-4"
            >
              <h2 id="conduct-title" className="text-h2">
                {askConduct.title}{" "}
                <span className="text-small text-text-muted">
                  version {askConduct.version}
                </span>
              </h2>
              <WaiverText body={askConduct.bodyMd} />
            </article>
          )}
          {!view.signature &&
            (underAge(
              view.minimumAge,
              person?.birthDate ?? null,
              localDay(new Date(), league?.timeZone ?? "America/New_York"),
            ) ? (
              <p role="alert" className="rounded-lg border border-warning p-3">
                {ageMessage("under_age", view.minimumAge)}
              </p>
            ) : (
              <SignWaiverForm
                action={signWaiverAction.bind(null, slug)}
                shownSha256={view.bodySha256}
                fullName={fullName}
                minimumAge={view.minimumAge}
                conductSha256={askConduct?.bodySha256 ?? null}
              />
            ))}
          <Link href="/app" className="underline">
            Home
          </Link>
        </>
      )}
    </>
  );
}
