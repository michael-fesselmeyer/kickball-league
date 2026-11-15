import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/permission";
import { newestSeasonSlug } from "../load";
import { PageLoading } from "@/components/page-loading";

/** Where the reminder emails point: the newest season's permits. */
export default function PermitsHome() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Go />
      </Suspense>
    </main>
  );
}

async function Go(): Promise<never> {
  await requirePermission("books.manage", { next: "/app/books/permits" });
  const slug = await newestSeasonSlug();
  if (!slug) notFound();
  redirect(`/app/books/${slug}/permits`);
}
