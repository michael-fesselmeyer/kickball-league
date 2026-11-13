import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { socialAccount, socialImage, socialPost } from "@/db/schema";
import type {
  LeagueId,
  SocialAccountId,
  SocialImageId,
  SocialPostId,
} from "@/domain/ids";
import { fixturePhoto } from "@/services/instagram-fixture";
import type { SeedData } from "./generate";

/**
 * Photos for the demo league's home and team pages, as if an admin had
 * synced Instagram and curated it, then disconnected and kept the photos.
 * The pictures are drawn stripes (src/services/instagram-fixture.ts), never
 * real photos, and the captions are invented. The account is disconnected,
 * so the demo admin can connect the recorded fixture and see a sync. Fixed
 * ids in their own range.
 */

const seedId = <T extends string>(n: number) =>
  `1a195000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

const ACCOUNT_ID = seedId<SocialAccountId>(1);

type SeedPost = {
  caption: string;
  day: string;
  featured?: true;
  hidden?: true;
  team?: string;
  cover?: "home" | "team";
};

const POSTS: readonly SeedPost[] = [
  {
    caption: "Week one in the books. Sunburns and new friends all around.",
    day: "2026-09-13T21:00:00Z",
    featured: true,
    cover: "home",
  },
  {
    caption: "The Big Kicks warming up with their signature high-five line.",
    day: "2026-09-20T19:00:00Z",
    featured: true,
    team: "the-big-kicks",
    cover: "team",
  },
  {
    caption: "Diving catch of the season? Tell us in the comments.",
    day: "2026-09-27T20:30:00Z",
    featured: true,
    team: "the-big-kicks",
  },
  {
    caption: "Post-game trivia night. Pickles were involved.",
    day: "2026-10-04T23:45:00Z",
    featured: true,
  },
  {
    caption: "Rain delay, so we danced.",
    day: "2026-10-11T18:15:00Z",
    featured: true,
  },
  {
    caption: "Behind the scenes: lining the fields at 9 a.m.",
    day: "2026-10-18T13:00:00Z",
  },
  {
    caption: "A blurry one we'd rather not show.",
    day: "2026-10-25T21:00:00Z",
    hidden: true,
  },
];

export function generateInstagramPhotos(data: SeedData) {
  const teamId = (slug: string) => {
    const found = data.teams.find((t) => t.slug === slug);
    if (!found) throw new Error(`No seed team ${slug}`);
    return found.id;
  };
  const account = {
    id: ACCOUNT_ID,
    leagueId: data.league.id,
    provider: "instagram" as const,
    externalId: "17841400000000001",
    username: "mccarrenkickball.example",
    status: "disconnected" as const,
    tokenCiphertext: null,
    lastSyncedAt: new Date("2026-10-26T12:00:00Z"),
  };
  const posts = POSTS.map((p, i) => ({
    id: seedId<SocialPostId>(100 + i),
    accountId: ACCOUNT_ID,
    externalId: `seed-${i + 1}`,
    permalink: `https://www.instagram.com/p/DemoPost${i + 1}/`,
    caption: p.caption,
    mediaType: "image" as const,
    takenAt: new Date(p.day),
    featured: p.featured ?? false,
    hidden: p.hidden ?? false,
    teamId: p.team ? teamId(p.team) : null,
    cover: p.cover ?? null,
  }));
  const images = posts.map((post, i) => {
    const bytes = fixturePhoto(post.permalink, POSTS[i]?.cover ? 960 : 480);
    return {
      id: seedId<SocialImageId>(200 + i),
      postId: post.id,
      contentType: "image/png",
      bytes,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  return { account, posts, images };
}

/** Removes the seeded photos before the demo league's teams are deleted. */
export async function removeInstagramPhotos(
  db: Db,
  leagueId: LeagueId,
): Promise<void> {
  // Posts and their photos cascade.
  await db.delete(socialAccount).where(eq(socialAccount.leagueId, leagueId));
}

export async function addInstagramPhotos(
  db: Db,
  data: SeedData,
): Promise<void> {
  const { account, posts, images } = generateInstagramPhotos(data);
  await db.insert(socialAccount).values(account);
  await db.insert(socialPost).values(posts);
  await db.insert(socialImage).values(images);
}
