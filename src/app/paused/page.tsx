import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { db } from "@/db/client";
import { siteSettings } from "@/db/queries/platform";
import { readUnlessBuildHasNoDatabase } from "@/lib/build-phase";
import { PUBLIC_PAGE_LIFE, SITE_TAG } from "@/lib/public-cache";

export const metadata: Metadata = {
  title: "Paused",
  robots: { index: false },
};

/**
 * Static HTML with no loading state, so the notice is the first paint (as
 * the season and game pages, ADR 0029). The operator's status change
 * expires it (`refreshSiteNotice`).
 */
export const ensureStatic = "navigation";

/**
 * The site's name and status, kept until the operator changes the status.
 * A build without a database to read prerenders the plain notice; the
 * operator's next change, or the cache's life running out, replaces it.
 */
async function cachedSite() {
  "use cache";
  cacheLife(PUBLIC_PAGE_LIFE);
  cacheTag(SITE_TAG);
  const site = await readUnlessBuildHasNoDatabase(() => siteSettings(db));
  return site ? { name: site.name, status: site.status } : null;
}

/**
 * Where the proxy sends public pages while the site is paused, and where a
 * change lands while it is read-only or paused. Plain words, no jokes.
 */
export default function PausedPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
      <Notice />
    </main>
  );
}

async function Notice() {
  const site = await cachedSite();
  const name = site?.name ?? "The league";
  if (site?.status === "read_only")
    return (
      <>
        <h1 className="text-h1">Changes are on hold</h1>
        <p>
          {name}&apos;s site is read-only for now. Everything is still there to
          see, but nothing can be changed, so your last change was not saved.
        </p>
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Back to your home page
        </Link>
      </>
    );
  if (site?.status === "paused")
    return (
      <>
        <h1 className="text-h1">This site is paused</h1>
        <p>
          {name}&apos;s site is paused for now. League admins can still sign in
          and download the league&apos;s data.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Sign in
        </Link>
      </>
    );
  return (
    <>
      <h1 className="text-h1">Everything is running</h1>
      <p>The site isn&apos;t paused.</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center self-start underline"
      >
        Go to the home page
      </Link>
    </>
  );
}
