import { describe, expect, it } from "vitest";
import { shareMetadata } from "./metadata";

describe("shareMetadata", () => {
  it("points Open Graph and Twitter at the generated image", () => {
    const meta = shareMetadata({
      title: "Kickers 5, Sluggers 3",
      description: "Fall 2026",
      path: "/games/g1",
      image: { path: "/games/g1/share.png?v=abc", alt: "Final" },
    });
    expect(meta.openGraph).toMatchObject({
      siteName: "Kickball League",
      title: "Kickers 5, Sluggers 3",
      url: "/games/g1",
      images: [
        {
          url: "/games/g1/share.png?v=abc",
          width: 1200,
          height: 630,
          alt: "Final",
        },
      ],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
