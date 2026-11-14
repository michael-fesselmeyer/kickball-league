import Link from "next/link";
import type { ComponentProps } from "react";
import { leagueHref } from "@/domain/league/paths";
import { activeLeague } from "@/lib/league/active";

/**
 * A link from the signed-in app to a public page of the league the app is
 * showing (ADR 0048): `/teams/x` for the default league, `/l/<slug>/teams/x`
 * for another. Only in the app, which may read the league cookie.
 */
export async function LeagueLink({
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const league = await activeLeague();
  return <Link href={league ? leagueHref(league, href) : href} {...props} />;
}
