import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fixturePhoto } from "@/services/instagram-fixture";
import { compressPhoto, STORED_WIDTH } from "./compress-photo";

describe("compressPhoto", () => {
  it("shrinks a wide photo to the widest size the pages show, as WebP", async () => {
    // Noise stands in for a real photo, which barely compresses losslessly.
    const original = await sharp({
      create: {
        width: 1440,
        height: 1440,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: 30 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const stored = await compressPhoto(original);
    if (!stored) throw new Error("not compressed");
    expect(stored.contentType).toBe("image/webp");
    const meta = await sharp(stored.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(STORED_WIDTH);
    expect(meta.height).toBe(STORED_WIDTH);
    expect(stored.bytes.length).toBeLessThan(original.length);
  });

  it("never enlarges a smaller photo", async () => {
    const stored = await compressPhoto(fixturePhoto("small", 360));
    if (!stored) throw new Error("not compressed");
    expect((await sharp(stored.bytes).metadata()).width).toBe(360);
  });

  it("drops metadata such as a phone's location", async () => {
    const tagged = await sharp(fixturePhoto("tagged", 400))
      .jpeg()
      .withExif({ IFD0: { Artist: "Someone Example" } })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const stored = await compressPhoto(tagged);
    if (!stored) throw new Error("not compressed");
    expect((await sharp(stored.bytes).metadata()).exif).toBeUndefined();
  });

  it("refuses bytes that are not an image", async () => {
    expect(await compressPhoto(Buffer.from("<html>not a photo</html>"))).toBe(
      null,
    );
  });
});
