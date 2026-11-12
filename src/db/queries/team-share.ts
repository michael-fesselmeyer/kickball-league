import { teamCard } from "@/domain/share/cards";
import { teamBySlug } from "./public-schedule";
import type { Db } from "./schedule";
import { seasonStandings } from "./standings";

const PLAYING = new Set(["in_progress", "playoffs"]);

/**
 * A team's share card: its current season (the one being played, else the
 * newest), its record and its last five results. Null for an unknown team.
 */
export async function teamShare(db: Db, slug: string) {
  const team = await teamBySlug(db, slug);
  if (!team) return null;
  const entry =
    team.entries.find((e) => PLAYING.has(e.seasonStatus)) ?? team.entries[0];
  const standings = entry ? await seasonStandings(db, entry.seasonId) : null;
  const row = standings?.rows.find((r) => r.teamId === entry?.id) ?? null;
  return {
    team,
    entry: entry ?? null,
    row,
    card: teamCard({
      name: team.name,
      color: team.colorHex,
      season: entry?.seasonName ?? null,
      vibe: entry?.vibe ?? null,
      standing: row,
    }),
  };
}
