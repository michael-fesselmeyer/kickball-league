import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { league } from "@/db/schema/league";
import { team } from "@/db/schema/team";
import { SEED_LEAGUE_SLUG, TEAMS } from "./generate";
import { RETIRED_TEAMS } from "./past-seasons";

/**
 * The laptop demo's private branding (docs/demo.md): `npm run demo` passes a
 * league's own name and team names in the environment, and `demo:reset`
 * writes them over the seed's invented ones. Slugs, colors and ids stay, so
 * every link, color and seeded relation keeps working.
 */
export type DemoBranding = {
  leagueName: string | null;
  teamNames: string[];
};

type Source = Readonly<Record<string, string | undefined>>;

/** Reads SITE_NAME and DEMO_TEAM_NAMES (a JSON list); anything else is ignored. */
export function demoBranding(source: Source): DemoBranding {
  const leagueName = source.SITE_NAME?.trim() || null;
  let teamNames: string[] = [];
  if (source.DEMO_TEAM_NAMES) {
    const parsed: unknown = JSON.parse(source.DEMO_TEAM_NAMES);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((n) => typeof n === "string" && n.trim() !== "")
    )
      throw new Error("DEMO_TEAM_NAMES must be a JSON list of team names.");
    teamNames = parsed.map((n: string) => n.trim());
  }
  return { leagueName, teamNames };
}

/** The order seeded teams take new names in: this season's, then retired ones. */
const SEED_ORDER = [...TEAMS, ...RETIRED_TEAMS].map((t) => t.slug);

/**
 * Pairs the league's teams with the new names: the seed's teams first, in
 * the seed's order, then any other team by slug. Extra names go unused;
 * with fewer names, the rest keep theirs.
 */
export function teamRenames<T extends { slug: string }>(
  teams: readonly T[],
  names: readonly string[],
): { team: T; name: string }[] {
  const rank = (slug: string) => {
    const i = SEED_ORDER.indexOf(slug);
    return i === -1 ? SEED_ORDER.length : i;
  };
  const ordered = [...teams].sort(
    (a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug),
  );
  return ordered
    .slice(0, names.length)
    .map((t, i) => ({ team: t, name: names[i]! }));
}

/** Writes the branding over the seeded league; returns how many teams it renamed. */
export async function brandDemoLeague(
  db: Db,
  branding: DemoBranding,
): Promise<number> {
  const [seeded] = await db
    .select({ id: league.id })
    .from(league)
    .where(eq(league.slug, SEED_LEAGUE_SLUG));
  if (!seeded) return 0;
  if (branding.leagueName)
    await db
      .update(league)
      .set({ name: branding.leagueName })
      .where(eq(league.id, seeded.id));
  if (branding.teamNames.length === 0) return 0;
  const teams = await db
    .select({ id: team.id, slug: team.slug })
    .from(team)
    .where(and(eq(team.leagueId, seeded.id), isNull(team.deletedAt)));
  const renames = teamRenames(teams, branding.teamNames);
  for (const { team: t, name } of renames)
    await db.update(team).set({ name }).where(eq(team.id, t.id));
  return renames.length;
}
