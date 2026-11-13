import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/permission";
import { newestSeasonSlug } from "./load";

/** The books open on the newest season. */
export default function BooksHome() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p>Loading…</p>}>
        <Go />
      </Suspense>
    </main>
  );
}

async function Go(): Promise<never> {
  await requirePermission("books.manage", { next: "/app/books" });
  const slug = await newestSeasonSlug();
  if (!slug) notFound();
  redirect(`/app/books/${slug}`);
}
