import { event } from "@/db/schema/event";
import { friendLeague } from "@/db/schema/friends";
import { guestTeam, tournament } from "@/db/schema/tournament";
import type { Db } from "@/db/queries/schedule";
import { eventSlug, parseEventForm } from "@/domain/events/event";
import type { EventId, FriendLeagueId } from "@/domain/ids";
import { newLinkToken } from "@/domain/tournaments/tournament";
import type { SeedData } from "./generate";

/**
 * The demo league's partner tournament: a charity cup with another kickball
 * league in the city (an invented one), a donation link and goal, and two
 * guest teams that have signed up. Names, emails and the link are invented.
 * The bracket is not drawn, so a demo can draw it. Removed with the
 * league's events (the tournament and guest teams go with their event).
 */
const EVENT_ID = "e7e00000-0000-4000-8000-000000000101" as EventId;
const FRIEND_ID = "f7e00000-0000-4000-8000-000000000101" as FriendLeagueId;

export async function addSeedTournament(db: Db, data: SeedData): Promise<void> {
  const timeZone = data.league.timezone;
  const parsed = parseEventForm(
    {
      kind: "tournament",
      title: "Harbor Cup charity tournament",
      place: "McCarren Park, north fields",
      description:
        "A one-day tournament with Borough Bases, another kickball league in the city. Guest teams are welcome: a captain signs up, and every player signs the waiver from a link. We're playing for a neighborhood food pantry.",
      capacity: "",
      startsOn: "2027-06-12",
      startTime: "10:00",
      endsOn: "",
      endTime: "16:00",
    },
    timeZone,
  );
  if (!parsed.ok) throw new Error(`Seed tournament: ${parsed.error}`);
  await db.insert(friendLeague).values({
    id: FRIEND_ID,
    leagueId: data.league.id,
    name: "Borough Bases Kickball",
    activity: "other",
    area: "Brooklyn",
    description: "Another kickball league in the city that plays with us.",
    url: "https://borough-bases.example.test/",
    linksBack: true,
  });
  await db.insert(event).values({
    id: EVENT_ID,
    leagueId: data.league.id,
    slug: eventSlug(parsed.value.title, parsed.value.startsAt, timeZone),
    ...parsed.value,
  });
  await db.insert(tournament).values({
    eventId: EVENT_ID,
    guestSignupsOpen: true,
    maxGuestTeams: 8,
    partnerFriendLeagueId: FRIEND_ID,
    charityName: "Neighborhood Food Pantry (demo)",
    charityUrl: "https://pantry.example.test/give",
    charityGoalCents: 250_000,
    guestDataDays: 30,
  });
  await db.insert(guestTeam).values([
    {
      eventId: EVENT_ID,
      name: "Borough Bases Blue",
      captainName: "Sam Example",
      captainEmail: "sam@example.test",
      rosterSize: 10,
      linkToken: newLinkToken(),
    },
    {
      eventId: EVENT_ID,
      name: "Borough Bases Gold",
      captainName: "Alex Sample",
      captainEmail: "alex@example.test",
      rosterSize: 9,
      linkToken: newLinkToken(),
    },
  ]);
}
