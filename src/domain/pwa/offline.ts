import type { Subject } from "../authz/permissions";
import { kickoff, shortDay } from "../schedule/format";
import { isCalledOff, type PublicGame } from "../schedule/public-game";

/**
 * Rules for the installable app (docs/architecture.md, section 14): who is
 * offered the install prompt, and which one game the device keeps for when
 * the field has no signal.
 */

/**
 * Captains, co-captains, referees and admins: the people who run game day
 * from their phones. Everyone else can still install from the browser menu.
 */
export function offeredInstall(subject: Subject): boolean {
  if (subject.userId === null) return false;
  if (subject.globalRole === "admin" || subject.globalRole === "owner")
    return true;
  if (subject.isReferee) return true;
  return subject.roster.some(
    (m) => m.role === "captain" || m.role === "co_captain",
  );
}

/** A game stays "next" until this long after kickoff, so it is kept while it is played. */
export const NEXT_GAME_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * The game to keep offline: the soonest one that has a time, has not
 * finished and was not called off, counting a game until three hours after
 * kickoff. Null when there is none.
 */
export function pickNextGame(
  games: readonly PublicGame[],
  now: Date,
): PublicGame | null {
  const from = now.getTime() - NEXT_GAME_GRACE_MS;
  let next: { game: PublicGame; at: number } | null = null;
  for (const g of games) {
    const at = g.startsAt?.getTime();
    if (at === undefined || at < from) continue;
    if (g.status === "final" || g.status === "forfeit" || isCalledOff(g))
      continue;
    if (next === null || at < next.at) next = { game: g, at };
  }
  return next?.game ?? null;
}

/**
 * What the offline page links to: the game's page and a one-line label, and
 * for the game's ref and captains, its park permit page (ADR 0034) and, on
 * game day, its emergency contacts page until midnight after (ADR 0042).
 */
export type OfflineGame = {
  path: string;
  label: string;
  permit: string | null;
  emergency: string | null;
  /** ISO time the emergency page stops being kept. */
  emergencyUntil: string | null;
};

export function offlineGame(
  game: PublicGame,
  timeZone: string,
  withPermit = false,
  emergencyUntil: Date | null = null,
): OfflineGame {
  const matchup = `${game.teamA.name} vs ${game.teamB.name}`;
  return {
    path: `/games/${game.id}`,
    permit: withPermit ? `/app/games/${game.id}/permit` : null,
    emergency: emergencyUntil ? `/app/games/${game.id}/emergency` : null,
    emergencyUntil: emergencyUntil?.toISOString() ?? null,
    label: game.startsAt
      ? `${matchup}, ${shortDay(game.startsAt, timeZone)} at ${kickoff(game.startsAt, timeZone)}`
      : matchup,
  };
}
