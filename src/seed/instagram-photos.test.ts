import { describe, expect, it } from "vitest";
import { isShown } from "@/domain/social/sync-plan";
import { generateSeed } from "./generate";
import { generateInstagramPhotos } from "./instagram-photos";

describe("seeded Instagram photos", () => {
  const data = generateSeed();
  const { account, posts, images } = generateInstagramPhotos(data);

  it("are kept from a disconnected account, with no token", () => {
    expect(account).toMatchObject({
      status: "disconnected",
      tokenCiphertext: null,
    });
  });

  it("show a home cover, a team cover and a hidden photo, each linking to Instagram", () => {
    expect(posts.filter((p) => p.cover === "home")).toHaveLength(1);
    const teamCover = posts.find((p) => p.cover === "team");
    expect(teamCover?.teamId).toBeTruthy();
    expect(posts.some((p) => p.hidden && !p.featured && !p.cover)).toBe(true);
    expect(posts.filter((p) => isShown(p, false))).toHaveLength(5);
    for (const p of posts)
      expect(p.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
  });

  it("keep every picture small", () => {
    for (const image of images) {
      expect(image.byteSize).toBe(image.bytes.length);
      expect(image.byteSize).toBeLessThan(120_000);
    }
  });

  it("are the same on every seed", () => {
    const again = generateInstagramPhotos(generateSeed());
    expect(again.images.map((i) => i.sha256)).toEqual(
      images.map((i) => i.sha256),
    );
  });
});
