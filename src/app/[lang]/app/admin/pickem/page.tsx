import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { ownGamesAllowed } from "@/db/queries/pickem";
import { requirePermission } from "@/lib/auth/permission";
import { setOwnGamesAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague } from "@/lib/league/active";

export const metadata: Metadata = { title: "Pick'em settings" };

export default function PickemSettingsPage(
  props: PageProps<"/[lang]/app/admin/pickem">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the settings…</p>}>
        <Settings {...props} />
      </Suspense>
    </main>
  );
}

async function Settings({ searchParams }: PageProps<"/[lang]/app/admin/pickem">) {
  await requirePermission("pickem.manage", { next: "/app/admin/pickem" });
  const query = await searchParams;
  const league = await activeLeague();
  if (!league) notFound();
  const allowed = await ownGamesAllowed(db, league.id);
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Pick&apos;em settings</h1>
        <p className="text-text-muted">
          Players pick each game day&apos;s winners for bragging rights only: no
          money, no entry fee and no prizes. Picks lock as each game starts and
          count once its score is confirmed.
        </p>
      </header>
      {query.notice === "saved" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved.
        </p>
      )}
      <section aria-labelledby="own" className="flex flex-col gap-2">
        <h2 id="own" className="text-h2">
          Picking your own team&apos;s games
        </h2>
        <p>
          {allowed
            ? "Players may pick their own team's games, as well as everyone else's."
            : "Players can't pick their own team's games; those games stay off their card."}{" "}
          Picks already made stay as they are.
        </p>
        <form action={setOwnGamesAction.bind(null, !allowed)}>
          <SubmitButton className="btn btn-secondary">
            {allowed
              ? "Keep players off their own team's games"
              : "Let players pick their own team's games"}
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
