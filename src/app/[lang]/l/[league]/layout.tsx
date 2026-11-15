import { leagueSegments } from "@/lib/league/public";

/**
 * Every league's public pages (ADR 0048). The default league's pages are
 * served at the site's own URLs, which the proxy rewrites to the `_default`
 * segment; every other league's are at /l/<slug>. Each page takes its
 * league from this segment, never from a cookie or the query string.
 */
export async function generateStaticParams() {
  return leagueSegments();
}

export default function LeagueLayout({ children }: LayoutProps<"/[lang]/l/[league]">) {
  return children;
}
