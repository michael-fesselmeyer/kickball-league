import { getImageProps } from "next/image";
import { describe, expect, it } from "vitest";
import { photoCacheHeaders, photoSrc } from "./photo-src";

const ID = "6f1c2b9e-4d0a-4c47-9a53-2f0e8d1b7c11";

describe("photoSrc", () => {
  it("gives each kind of stored photo its public address", () => {
    expect(photoSrc.instagram(ID)).toBe(`/media/instagram/${ID}`);
    expect(photoSrc.member(ID)).toBe(`/media/photos/${ID}`);
    expect(photoSrc.merch(ID)).toBe(`/media/merch/${ID}`);
  });

  it("is the exact source the optimizer's URLs carry, so a purge matches it", () => {
    for (const src of Object.values(photoSrc).map((f) => f(ID))) {
      const { props } = getImageProps({
        src,
        alt: "",
        fill: true,
        sizes: "50vw",
      });
      for (const candidate of props.srcSet?.split(", ") ?? []) {
        const url = new URL(candidate.split(" ")[0]!, "https://example.test");
        expect(url.pathname).toBe("/_next/image");
        expect(url.searchParams.get("url")).toBe(src);
      }
    }
  });
});

describe("photoCacheHeaders", () => {
  it("keeps the address five minutes and tags it with itself for purging", () => {
    expect(photoCacheHeaders(photoSrc.member(ID))).toEqual({
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Vercel-Cache-Tag": `/media/photos/${ID}`,
    });
  });

  it("makes a tag the host accepts: no comma, at most 256 bytes", () => {
    const tag = photoCacheHeaders(photoSrc.instagram(ID))["Vercel-Cache-Tag"]!;
    expect(tag).not.toContain(",");
    expect(Buffer.byteLength(tag)).toBeLessThanOrEqual(256);
  });
});
