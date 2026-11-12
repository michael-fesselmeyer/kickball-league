import type { Schedule } from "./types";

export type ScheduleDiff = {
  /** Games in both versions whose slot changed (null means unplaced). */
  moved: { gameKey: string; from: string | null; to: string | null }[];
  /** Games only in the newer version. */
  added: string[];
  /** Games only in the older version. */
  removed: string[];
  /** Every team with a moved, added or removed game, sorted. */
  teams: string[];
};

/**
 * What changed between two versions of a schedule, for the publish preview:
 * which games moved and which teams to tell (scheduling-algorithm.md,
 * section 6). Games are matched by their stable key.
 */
export function diffSchedules(before: Schedule, after: Schedule): ScheduleDiff {
  const old = new Map(before.games.map((g) => [g.key, g]));
  const next = new Map(after.games.map((g) => [g.key, g]));
  const teams = new Set<string>();
  const touch = (g: { teamA: string; teamB: string }) => {
    teams.add(g.teamA);
    teams.add(g.teamB);
  };

  const moved: ScheduleDiff["moved"] = [];
  const added: string[] = [];
  for (const [key, game] of next) {
    const was = old.get(key);
    if (!was) {
      added.push(key);
      touch(game);
    } else if (was.slotId !== game.slotId) {
      moved.push({ gameKey: key, from: was.slotId, to: game.slotId });
      touch(game);
    }
  }
  const removed: string[] = [];
  for (const [key, game] of old)
    if (!next.has(key)) {
      removed.push(key);
      touch(game);
    }

  return {
    moved: moved.sort((a, b) => a.gameKey.localeCompare(b.gameKey)),
    added: added.sort(),
    removed: removed.sort(),
    teams: [...teams].sort(),
  };
}
