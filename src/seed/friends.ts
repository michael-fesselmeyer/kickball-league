import { createHash } from "node:crypto";
import type { Db } from "@/db/queries/schedule";
import { friendLeague, friendLogo } from "@/db/schema";
import type { FriendFields } from "@/domain/friends/friend-form";
import { fixturePhoto } from "@/services/instagram-fixture";
import type { SeedData } from "./generate";

/**
 * The demo league's friends directory: invented local leagues on
 * example.test sites, two with a drawn logo (stripes, like the seeded
 * Instagram photos). Entries go with the league when it is deleted.
 */
export const SEED_FRIENDS: readonly (FriendFields & { logo: boolean })[] = [
  {
    name: "Greenpoint Slow-Pitch Social",
    activity: "softball",
    area: "McCarren Park",
    description:
      "Coed slow-pitch on Saturday mornings. Gloves to borrow, and a team for anyone who signs up alone.",
    url: "https://slow-pitch-social.example.test/",
    linksBack: true,
    logo: true,
  },
  {
    name: "Northside Sunday Soccer",
    activity: "soccer",
    area: "Bushwick Inlet Park",
    description: "Seven-a-side, all levels, with a pickup night in the summer.",
    url: "https://northside-soccer.example.test/",
    linksBack: false,
    logo: true,
  },
  {
    name: "Rack 'Em Wednesdays",
    activity: "pool",
    area: "Williamsburg",
    description: "A bar pool league with handicaps, so beginners win too.",
    url: "https://rack-em-wednesdays.example.test/",
    linksBack: true,
    logo: false,
  },
  {
    name: "Meeple Night Collective",
    activity: "tabletop",
    area: "Greenpoint",
    description:
      "Board game nights twice a month. Bring a game or learn one at the table.",
    url: "https://meeple-night.example.test/",
    linksBack: false,
    logo: false,
  },
];

export const SEED_LOGO_SIZE = 128;

export async function addSeedFriends(db: Db, data: SeedData): Promise<void> {
  for (const { logo, ...fields } of SEED_FRIENDS) {
    const [created] = await db
      .insert(friendLeague)
      .values({ leagueId: data.league.id, ...fields })
      .returning({ id: friendLeague.id });
    if (!created || !logo) continue;
    const bytes = fixturePhoto(fields.url, SEED_LOGO_SIZE);
    await db.insert(friendLogo).values({
      friendLeagueId: created.id,
      contentType: "image/png",
      bytes,
      byteSize: bytes.length,
      width: SEED_LOGO_SIZE,
      height: SEED_LOGO_SIZE,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
