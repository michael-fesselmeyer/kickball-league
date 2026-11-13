import { eq } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { event, eventRsvp } from "@/db/schema/event";
import {
  type EventInput,
  eventSlug,
  parseEventForm,
} from "@/domain/events/event";
import type { EventId, LeagueId } from "@/domain/ids";
import type { SeedData } from "./generate";

/**
 * The demo league's events (src/db/schema/event.ts): two theme weeks on
 * Fall 2026 game days, a wrap party, and a winter and spring calendar with
 * one full event and its waitlist. Places are invented demo venues.
 */
export const SEED_EVENTS = [
  {
    kind: "theme_week",
    title: "Neon week",
    place: "",
    description:
      "Bright colors, glow sticks, highlighter-yellow socks. The loudest team gets bragging rights.",
    capacity: "",
    startsOn: "2026-09-28",
    startTime: "",
    endsOn: "2026-10-04",
    endTime: "",
  },
  {
    kind: "theme_week",
    title: "Costume week",
    place: "",
    description:
      "Come to your game in costume. Team costumes get a shout-out on the recap.",
    capacity: "",
    startsOn: "2026-10-26",
    startTime: "",
    endsOn: "2026-11-01",
    endTime: "",
  },
  {
    kind: "bar_night",
    title: "Season wrap party",
    place: "The Dugout Lounge (demo venue), 100 Example Ave, Brooklyn",
    description:
      "Awards, the season slideshow and a lot of high-fives. Food and soft drinks on the league.",
    capacity: "60",
    startsOn: "2026-10-31",
    startTime: "20:00",
    endsOn: "",
    endTime: "23:00",
  },
  {
    kind: "social",
    title: "Board game night",
    place: "Corner Table Café (demo venue), 200 Sample St, Brooklyn",
    description:
      "Off-season catch-up over board games and hot chocolate. Bring a game or learn a new one.",
    capacity: "",
    startsOn: "2027-01-15",
    startTime: "19:00",
    endsOn: "",
    endTime: "22:00",
  },
  {
    kind: "tournament",
    title: "Winter pickup tournament",
    place: "McCarren Park, north fields",
    description:
      "Mixed pickup teams drawn on the day. Short games, lots of them, and hot cider at the end.",
    capacity: "64",
    startsOn: "2027-02-20",
    startTime: "10:00",
    endsOn: "",
    endTime: "15:00",
  },
  {
    kind: "bbq",
    title: "Spring kickoff BBQ",
    place: "McCarren Park, north picnic area",
    description:
      "Meet your new teammates before opening day. Burgers, veggie dogs and lawn games.\n\nSpace at the picnic area is limited, so RSVP. If it's full, join the waitlist: spots open up.",
    capacity: "12",
    startsOn: "2027-04-10",
    startTime: "12:00",
    endsOn: "",
    endTime: "16:00",
  },
] as const;

/** RSVPs per event, in order, by title: the BBQ fills and has a waitlist. */
const RSVPS: Record<string, { going: number; waitlisted: number }> = {
  "Season wrap party": { going: 41, waitlisted: 0 },
  "Board game night": { going: 9, waitlisted: 0 },
  "Winter pickup tournament": { going: 23, waitlisted: 0 },
  "Spring kickoff BBQ": { going: 12, waitlisted: 3 },
};

/** When the seeded RSVPs start: in the past, so a new RSVP joins the end. */
const RSVPS_FROM = Date.parse("2026-10-01T15:00:00Z");

const eventId = (n: number) =>
  `e7e00000-0000-4000-8000-${String(n).padStart(12, "0")}` as EventId;

export function seedEventRows(data: SeedData) {
  const timeZone = data.league.timezone;
  const events = SEED_EVENTS.map((form, i) => {
    const parsed = parseEventForm(form, timeZone);
    if (!parsed.ok)
      throw new Error(`Seed event ${form.title}: ${parsed.error}`);
    const input: EventInput = parsed.value;
    return {
      id: eventId(i + 1),
      leagueId: data.league.id,
      slug: eventSlug(input.title, input.startsAt, timeZone),
      ...input,
    };
  });
  // Players RSVP an hour apart, in order, so the waitlist has a line.
  const rsvps = events.flatMap((e) => {
    const plan = RSVPS[e.title];
    if (!plan) return [];
    const people = data.users.slice(1, 1 + plan.going + plan.waitlisted);
    return people.map((u, i) => ({
      eventId: e.id,
      userId: u.id,
      status: i < plan.going ? ("going" as const) : ("waitlisted" as const),
      createdAt: new Date(RSVPS_FROM + i * 3_600_000),
    }));
  });
  return { events, rsvps };
}

/** Removes a league's events (their RSVPs go with them). */
export async function removeSeedEvents(db: Db, leagueId: LeagueId) {
  await db.delete(event).where(eq(event.leagueId, leagueId));
}

export async function addSeedEvents(db: Db, data: SeedData): Promise<void> {
  const { events, rsvps } = seedEventRows(data);
  await db.insert(event).values(events);
  if (rsvps.length) await db.insert(eventRsvp).values(rsvps);
}
