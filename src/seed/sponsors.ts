import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  checkin,
  deal,
  dealRedemption,
  sponsor,
  teamOfWeek,
} from "@/db/schema";
import type {
  CheckinId,
  DealId,
  LeagueId,
  SponsorId,
  TeamOfWeekId,
  UserId,
} from "@/domain/ids";
import { seededRandom } from "@/domain/random";
import { localDay } from "@/domain/schedule/public-game";
import { newCheckinSecret } from "@/domain/sponsors/checkin-code";
import { dealApplies } from "@/domain/sponsors/deals";
import {
  suggestionReason,
  suggestTeamsOfWeek,
} from "@/domain/sponsors/team-of-week";
import type { StatGame } from "@/domain/stats/games";
import { localTime } from "@/domain/time/zoned";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/**
 * Sponsors for the demo league, all invented: a home bar with food and
 * soft-drink deals as well as drink ones, a deli and a sports shop. Players
 * from the played game days check in at the home bar after their games and
 * some use a deal, so the weekly numbers have something to show, and each
 * played game day after the first has a team of the week.
 * Fixed ids, so the sponsors are the same after every reseed.
 */
const rowId = <T extends string>(n: number) =>
  `5b0a0000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export const SEED_HOME_BAR_SLUG = "the-corner-pocket";

export function seedSponsorRows(data: SeedData) {
  const random = seededRandom(190);
  const leagueId = data.league.id;
  const timeZone = data.league.timezone;
  const homeBar = rowId<SponsorId>(1);
  const sponsors = [
    {
      id: homeBar,
      leagueId,
      name: "The Corner Pocket",
      slug: SEED_HOME_BAR_SLUG,
      kind: "bar" as const,
      isHomeBar: true,
      blurb:
        "Two blocks from the park: big booths, shuffleboard, a kitchen open late and plenty on tap that isn't beer.",
      address: "100 Example Ave, Brooklyn, NY",
      url: "https://corner-pocket.example.test/",
    },
    {
      id: rowId<SponsorId>(2),
      leagueId,
      name: "Pickle & Rye",
      slug: "pickle-and-rye",
      kind: "restaurant" as const,
      isHomeBar: false,
      blurb: "The deli on the corner. Sandwiches big enough to share.",
      address: "200 Example St, Brooklyn, NY",
      url: null,
    },
    {
      id: rowId<SponsorId>(3),
      leagueId,
      name: "Bounce Sports Supply",
      slug: "bounce-sports-supply",
      kind: "brand" as const,
      isHomeBar: false,
      blurb: "Cleats, balls and team colors for the whole league.",
      address: null,
      url: "https://bounce-supply.example.test/",
    },
  ].map((s) => ({ ...s, checkinSecret: newCheckinSecret() }));

  const confirmedAt = new Date("2026-10-26T14:00:00Z");
  const deals = [
    {
      id: rowId<DealId>(101),
      sponsorId: homeBar,
      title: "$2 off any burger or veggie burger",
      terms: "Show your check-in screen.",
      validDays: [] as number[],
      validFrom: null,
      validTo: null,
    },
    {
      id: rowId<DealId>(102),
      sponsorId: homeBar,
      title: "Free refills on sodas, seltzers and iced tea",
      terms: null,
      validDays: [],
      validFrom: null,
      validTo: null,
    },
    {
      id: rowId<DealId>(103),
      sponsorId: homeBar,
      title: "Half-price fries after a league game",
      terms: "One basket per table.",
      validDays: [2],
      validFrom: "21:00",
      validTo: "00:00",
    },
    {
      id: rowId<DealId>(104),
      sponsorId: rowId<SponsorId>(2),
      title: "Free pickle with any sandwich",
      terms: null,
      validDays: [],
      validFrom: null,
      validTo: null,
    },
    {
      id: rowId<DealId>(105),
      sponsorId: rowId<SponsorId>(3),
      title: "15% off cleats for league players",
      terms: "Show your check-in screen at the register.",
      validDays: [],
      validFrom: null,
      validTo: null,
    },
  ].map((d) => ({ ...d, confirmedAt }));
  const barDeals = deals.filter((d) => d.sponsorId === homeBar);

  const teamOf = new Map(
    data.rosterMemberships.map((m) => [m.registrationId, m.teamSeasonId]),
  );
  const playersOf = new Map<string, UserId[]>();
  for (const r of data.registrations) {
    const team = teamOf.get(r.id);
    if (team) playersOf.set(team, [...(playersOf.get(team) ?? []), r.userId]);
  }
  const slotEnd = new Map(data.slots.map((s) => [s.id, s.endsAt]));

  const checkins: (typeof checkin.$inferInsert & { id: CheckinId })[] = [];
  const redemptions: (typeof dealRedemption.$inferInsert)[] = [];
  const played = data.games.filter(
    (g) => g.roundNo <= PLAYED_ROUNDS && g.status === "final",
  );
  const seen = new Set<string>();
  for (const game of played) {
    const ended = slotEnd.get(game.slotId);
    if (!ended) continue;
    for (const team of [game.teamAId, game.teamBId]) {
      for (const userId of playersOf.get(team) ?? []) {
        if (random.next() > 0.45) continue;
        const at = new Date(ended.getTime() + random.int(15, 70) * 60_000);
        const onDate = localDay(ended, timeZone);
        const key = `${userId}:${onDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const id = rowId<CheckinId>(1000 + checkins.length);
        checkins.push({
          id,
          sponsorId: homeBar,
          userId,
          teamSeasonId: team,
          onDate,
          checkedInAt: at,
        });
        if (random.next() < 0.6) {
          const usable = barDeals.filter((d) =>
            dealApplies(d, onDate, localTime(at, timeZone)),
          );
          if (usable.length > 0)
            redemptions.push({
              dealId: random.pick(usable).id,
              checkinId: id,
              userId,
              redeemedAt: new Date(at.getTime() + 5 * 60_000),
            });
        }
      }
    }
  }

  // The team of the week for each played game day after the first, from the
  // same suggestions an admin sees.
  const teamName = new Map(
    data.teamSeasons.map((ts) => [
      ts.id as string,
      data.teams.find((t) => t.id === ts.teamId)?.name ?? "",
    ]),
  );
  const stats: StatGame[] = played.flatMap((g) => {
    const ended = slotEnd.get(g.slotId);
    return ended && g.scoreA !== null && g.scoreB !== null
      ? [
          {
            id: g.id,
            seasonId: g.seasonId,
            kind: "regular" as const,
            playedAt: ended,
            teamA: g.teamAId,
            teamB: g.teamBId,
            result: {
              kind: "played" as const,
              scoreA: g.scoreA,
              scoreB: g.scoreB,
            },
          },
        ]
      : [];
  });
  const dayOf = (d: Date) => localDay(d, timeZone);
  const days = [...new Set(stats.map((g) => dayOf(g.playedAt)))].sort();
  const honors = days.slice(1).flatMap((day, i) => {
    const [best] = suggestTeamsOfWeek(
      data.teamSeasons.map((t) => t.id),
      stats,
      day,
      dayOf,
    );
    if (!best) return [];
    return [
      {
        id: rowId<TeamOfWeekId>(500 + i),
        seasonId: data.season.id,
        weekOf: day,
        teamSeasonId: best.team as (typeof data.teamSeasons)[number]["id"],
        sponsorId: homeBar,
        tabCents: 5000,
        reason: suggestionReason(best, teamName.get(best.opponent) ?? ""),
      },
    ];
  });

  return { sponsors, deals, checkins, redemptions, honors };
}

/**
 * Removes the demo league's sponsors before the league itself: first the
 * teams of the week that name them, then the sponsors with their deals,
 * members, check-ins and redemptions.
 */
export async function removeSeedSponsors(
  tx: Db,
  leagueId: string,
): Promise<void> {
  const ids = tx
    .select({ id: sponsor.id })
    .from(sponsor)
    .where(eq(sponsor.leagueId, leagueId as LeagueId));
  await tx.delete(teamOfWeek).where(inArray(teamOfWeek.sponsorId, ids));
  await tx.delete(sponsor).where(eq(sponsor.leagueId, leagueId as LeagueId));
}

export async function addSeedSponsors(tx: Db, data: SeedData): Promise<void> {
  const rows = seedSponsorRows(data);
  await tx.insert(sponsor).values(rows.sponsors);
  await tx.insert(deal).values(rows.deals);
  if (rows.checkins.length) await tx.insert(checkin).values(rows.checkins);
  if (rows.redemptions.length)
    await tx.insert(dealRedemption).values(rows.redemptions);
  if (rows.honors.length) await tx.insert(teamOfWeek).values(rows.honors);
}
