import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_STORED_BYTES,
  STORED_LONG_EDGE,
} from "@/domain/member-photos/limits";
import { processPhoto } from "./process-photo";

/** Noise stands in for a real photo, which barely compresses. */
const photo = (
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#3a7d44",
      noise: { type: "gaussian", mean: 128, sigma: 30 },
    },
  })
    .toFormat(format)
    .toBuffer();

const expectOk = <T>(
  r: { ok: true; value: T } | { ok: false; error: string },
) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("processPhoto", () => {
  it("shrinks a tall phone photo to the stored size, as one JPEG", async () => {
    const stored = expectOk(await processPhoto(await photo(1500, 2000)));
    const meta = await sharp(stored.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([1080, STORED_LONG_EDGE]);
    expect([stored.width, stored.height]).toEqual([1080, STORED_LONG_EDGE]);
    expect(stored.bytes.length).toBeLessThanOrEqual(MAX_STORED_BYTES);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never enlarges a small photo, and takes PNG and WebP", async () => {
    for (const format of ["png", "webp"] as const) {
      const stored = expectOk(
        await processPhoto(await photo(320, 240, format)),
      );
      expect((await sharp(stored.bytes).metadata()).format).toBe("jpeg");
      expect([stored.width, stored.height]).toEqual([320, 240]);
    }
  });

  it("turns the photo the way the camera held it", async () => {
    const sideways = await sharp(await photo(400, 300))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const stored = expectOk(await processPhoto(sideways));
    expect([stored.width, stored.height]).toEqual([300, 400]);
  });

  it("drops the phone's location and every other tag", async () => {
    const tagged = await sharp(await photo(400, 300))
      .jpeg()
      .withExif({
        IFD0: { Make: "ExamplePhone", Artist: "Someone Example" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 44/1 0/1" },
      })
      .toBuffer();
    const before = await sharp(tagged).metadata();
    expect(before.exif?.toString("latin1")).toContain("ExamplePhone");
    const stored = expectOk(await processPhoto(tagged));
    const after = await sharp(stored.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(stored.bytes.toString("latin1")).not.toContain("ExamplePhone");
  });

  it("refuses a file whose bytes don't match a photo", async () => {
    expect(await processPhoto(Buffer.from("<svg onload='x()'/>"))).toEqual({
      ok: false,
      error: "not_image",
    });
    // A JPEG signature on bytes that aren't a JPEG.
    const fake = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from("not really a photo at all"),
    ]);
    expect(await processPhoto(fake)).toEqual({
      ok: false,
      error: "unreadable",
    });
    // A real PNG renamed and relabelled as a JPEG still reads as PNG, and a
    // PNG header in front of WebP bytes is caught by the decoder.
    const webp = await photo(50, 50, "webp");
    const disguised = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      webp,
    ]);
    const result = await processPhoto(disguised);
    expect(result.ok).toBe(false);
  });

  it("refuses a decompression bomb before resizing it", async () => {
    // A tiny file that decodes to 10,000 by 10,000 pixels.
    const bomb = await sharp({
      create: {
        width: 10_000,
        height: 10_000,
        channels: 3,
        background: "#fff",
      },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(await processPhoto(bomb)).toEqual({
      ok: false,
      error: "unreadable",
    });
  });
});
