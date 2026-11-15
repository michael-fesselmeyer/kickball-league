import { getImgProps } from "next/dist/shared/lib/get-img-props";
import {
  imageConfigDefault,
  prepareImageConfig,
} from "next/dist/shared/lib/image-config";
import defaultLoader from "next/dist/shared/lib/image-loader";
import { describe, expect, it } from "vitest";
import { hostPurger } from "./host-purger";
import {
  HOST_PURGE_READY,
  LONG_PHOTO_LIFETIME,
  optimizedPhotoLifetime,
  PHOTO_DEVICE_SIZES,
  PHOTO_IMAGE_SIZES,
  SHORT_PHOTO_LIFETIME,
} from "./optimizer-cache";

describe("optimizedPhotoLifetime", () => {
  it("keeps optimized photos the host's full 31 days on Vercel once takedowns purge them", () => {
    expect(LONG_PHOTO_LIFETIME).toBe(2_678_400);
    expect(optimizedPhotoLifetime({ VERCEL: "1" }, true)).toBe(
      LONG_PHOTO_LIFETIME,
    );
  });

  it("keeps the photo's own five minutes anywhere nothing can purge them", () => {
    expect(SHORT_PHOTO_LIFETIME).toBe(300);
    expect(optimizedPhotoLifetime({}, true)).toBe(300);
    expect(optimizedPhotoLifetime({ VERCEL: "0" }, true)).toBe(300);
    expect(optimizedPhotoLifetime({ VERCEL: "1" }, false)).toBe(300);
  });

  it("goes long only together with the host's purge", () => {
    expect(hostPurger({ VERCEL: "1" }) !== null).toBe(HOST_PURGE_READY);
    expect(optimizedPhotoLifetime({ VERCEL: "1" })).toBe(
      HOST_PURGE_READY ? LONG_PHOTO_LIFETIME : SHORT_PHOTO_LIFETIME,
    );
    expect(hostPurger({})).toBeNull();
  });
});

describe("photo widths", () => {
  it("lists image sizes below every device size, as the optimizer expects", () => {
    expect(Math.max(...PHOTO_IMAGE_SIZES)).toBeLessThan(
      Math.min(...PHOTO_DEVICE_SIZES),
    );
  });

  it("offers each photo at eight widths at most, none above 1,920", () => {
    expect(PHOTO_DEVICE_SIZES.length + PHOTO_IMAGE_SIZES.length).toBe(8);
    expect(Math.max(...PHOTO_DEVICE_SIZES)).toBe(1920);
  });

  it("gives the photo grids and covers only widths from the allowed list", () => {
    const allowed = new Set<number>([
      ...PHOTO_DEVICE_SIZES,
      ...PHOTO_IMAGE_SIZES,
    ]);
    const imgConf = prepareImageConfig({
      ...imageConfigDefault,
      deviceSizes: [...PHOTO_DEVICE_SIZES],
      imageSizes: [...PHOTO_IMAGE_SIZES],
      qualities: [75],
    });
    for (const sizes of [
      // The grids (instagram-photos.tsx, member-photos.tsx)
      "(min-width: 1024px) 240px, (min-width: 768px) 25vw, 50vw",
      // The home page's cover
      "(min-width: 1024px) 1000px, 100vw",
    ]) {
      const { props } = getImgProps(
        { src: "/media/photos/1", alt: "", fill: true, sizes },
        { defaultLoader, imgConf },
      );
      const widths = (props.srcSet ?? "")
        .split(", ")
        .map((c) => Number(c.split(" ")[1]?.replace("w", "")));
      expect(widths.length).toBeGreaterThan(0);
      for (const w of widths) expect(allowed).toContain(w);
    }
  });
});

describe("next.config images", () => {
  it("allows only the photo widths, one format and one quality", async () => {
    process.env.SKIP_ENV_VALIDATION = "true";
    const { default: config } = await import("../../../next.config");
    expect(config.images).toMatchObject({
      deviceSizes: [...PHOTO_DEVICE_SIZES],
      imageSizes: [...PHOTO_IMAGE_SIZES],
      formats: ["image/webp"],
      qualities: [75],
      minimumCacheTTL: optimizedPhotoLifetime(process.env),
    });
  });
});
