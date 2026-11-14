import type { Db } from "@/db/queries/schedule";
import { memberPhoto } from "@/db/schema";
import { processPhoto } from "@/lib/member-photos/process-photo";
import { fixturePhoto } from "@/services/instagram-fixture";
import type { SeedData } from "./generate";

/**
 * Photos players of The Big Kicks shared (ADR 0039): three approved, on
 * their team page and one game's page, and two waiting in the admins'
 * review queue. The pictures are drawn stripes, processed as an upload is,
 * never real photos, and the captions are invented. They go with the demo
 * league and its seed users when the seed runs again (both cascade).
 */

type SeedPhoto = {
  caption: string | null;
  day: string;
  approved: boolean;
  /** Also tagged to the team's first played game. */
  game?: true;
};

const PHOTOS: readonly SeedPhoto[] = [
  {
    caption: "Victory lap after the first win of the season.",
    day: "2026-09-13T22:10:00Z",
    approved: true,
    game: true,
  },
  {
    caption: "Matching socks, as promised.",
    day: "2026-09-20T21:30:00Z",
    approved: true,
  },
  { caption: null, day: "2026-10-04T22:00:00Z", approved: true },
  {
    caption: "Our pitcher's famous wind-up.",
    day: "2026-10-18T21:45:00Z",
    approved: false,
  },
  {
    caption: "Group photo at the bar after.",
    day: "2026-10-25T23:30:00Z",
    approved: false,
  },
];

export async function generateMemberPhotos(data: SeedData) {
  const team = data.teams.find((t) => t.slug === "the-big-kicks");
  const entry = data.teamSeasons.find((e) => e.teamId === team?.id);
  if (!team || !entry) throw new Error("No seed team the-big-kicks");
  const players = data.rosterMemberships
    .filter((m) => m.teamSeasonId === entry.id)
    .flatMap(
      (m) =>
        data.registrations.find((r) => r.id === m.registrationId)?.userId ?? [],
    );
  const game = data.games.find(
    (g) =>
      g.status === "final" &&
      (g.teamAId === entry.id || g.teamBId === entry.id),
  );
  return Promise.all(
    PHOTOS.map(async (p, i) => {
      const processed = await processPhoto(
        fixturePhoto(`member-photo-${i}`, 720),
      );
      if (!processed.ok) throw new Error(processed.error);
      const uploaderId = players[(i + 1) % players.length];
      if (!uploaderId) throw new Error("No seed players on the-big-kicks");
      const at = new Date(p.day);
      return {
        leagueId: data.league.id,
        uploaderId,
        status: p.approved ? ("approved" as const) : ("pending" as const),
        teamId: team.id,
        gameId: p.game && game ? game.id : null,
        caption: p.caption,
        repostConsentAt: at,
        bytes: processed.value.bytes,
        byteSize: processed.value.bytes.length,
        width: processed.value.width,
        height: processed.value.height,
        sha256: processed.value.sha256,
        reviewedAt: p.approved ? new Date(at.getTime() + 3_600_000) : null,
        createdAt: at,
      };
    }),
  );
}

export async function addMemberPhotos(db: Db, data: SeedData): Promise<void> {
  await db.insert(memberPhoto).values(await generateMemberPhotos(data));
}
