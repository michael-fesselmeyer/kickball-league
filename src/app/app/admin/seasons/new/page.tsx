import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EMPTY_SEASON_FORM } from "@/domain/season/settings";
import { requirePermission } from "@/lib/auth/permission";
import { createSeasonAction } from "../actions";
import { SeasonSettingsForm } from "../season-form";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "New season" };

export default function NewSeasonPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/seasons" className="underline">
          All seasons
        </Link>
        <h1 className="text-h1">New season</h1>
        <p className="text-text-muted">
          It starts as a draft, so players see nothing until you open
          registration.
        </p>
      </header>
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <NewSeason />
      </Suspense>
    </main>
  );
}

async function NewSeason() {
  await requirePermission("season.manage", {
    next: "/app/admin/seasons/new",
  });
  return (
    <SeasonSettingsForm
      action={createSeasonAction}
      values={EMPTY_SEASON_FORM}
      submitLabel="Create season"
    />
  );
}
