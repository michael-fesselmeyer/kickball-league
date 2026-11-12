import { absoluteUrl, HOME_PARK, homeParkMapUrl, SITE } from "../site";
import type { LeagueInfo, ParkInfo } from "./structured-data";

/** The home park as structured data input, for the park page and every game. */
export function homeParkInfo(origin: string): ParkInfo {
  return {
    name: HOME_PARK.name,
    url: absoluteUrl(origin, HOME_PARK.path),
    address: HOME_PARK.address,
    geo: HOME_PARK.geo,
    mapUrl: homeParkMapUrl(),
  };
}

/**
 * The league as structured data input. Team and game pages pass this to
 * teamJsonLd and gameJsonLd so every node points at the same league.
 */
export function leagueInfo(origin: string): LeagueInfo {
  return {
    name: SITE.name,
    url: absoluteUrl(origin, "/"),
    description: SITE.description,
    sport: SITE.sport,
    areaServed: SITE.areaServed,
    park: homeParkInfo(origin),
  };
}
