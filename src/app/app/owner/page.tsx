import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { requirePermission } from "@/lib/auth/permission";
import { newestOwnerSeason } from "./load";

/** The dashboard opens on the newest season. */
export default function OwnerHome() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Go />
      </Suspense>
    </main>
  );
}

async function Go(): Promise<never> {
  await requirePermission("dashboard.view", { next: "/app/owner" });
  const slug = await newestOwnerSeason();
  if (!slug) notFound();
  redirect(`/app/owner/${slug}`);
}
