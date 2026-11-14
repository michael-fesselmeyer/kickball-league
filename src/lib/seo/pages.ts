import { type PublicGame, resultLine } from "@/domain/schedule/public-game";
import { absoluteUrl } from "../site";
import { homeParkInfo, leagueInfo } from "./league";
import { gameJsonLd, type JsonLd, teamJsonLd } from "./structured-data";

/**
 * Structured data for the public team and game pages (docs/seo-plan.md,
 * section 3), from what those pages already read: no extra queries.
 */

const teamUrl = (origin: string, slug: string) =>
  absoluteUrl(origin, `/teams/${slug}`);

/** A team page: a SportsTeam that is a member of the league. */
export function teamPageJsonLd(
  origin: string,
  team: { name: string; slug: string },
): JsonLd {
  return teamJsonLd(
    { name: team.name, url: teamUrl(origin, team.slug) },
    leagueInfo(origin),
  );
}

/**
 * A game page: a SportsEvent between its two teams at the park. A game whose
 * slot was called off (a rain-out waiting for a makeup) reads as postponed,
 * and a final carries its result as the description.
 */
export function gamePageJsonLd(origin: string, game: PublicGame): JsonLd {
  const status =
    game.slotCancelled && game.status === "scheduled"
      ? "postponed"
      : game.status;
  return gameJsonLd(
    {
      url: absoluteUrl(origin, `/games/${game.id}`),
      status,
      startsAt: game.startsAt ?? undefined,
      endsAt: game.endsAt ?? undefined,
      teams: [
        { name: game.teamA.name, url: teamUrl(origin, game.teamA.slug) },
        { name: game.teamB.name, url: teamUrl(origin, game.teamB.slug) },
      ],
      field: game.field ?? undefined,
      park: homeParkInfo(origin),
      description: resultLine(game) ?? undefined,
    },
    leagueInfo(origin),
  );
}
