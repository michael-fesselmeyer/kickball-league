import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LOGO_BOX, MAX_STORED_LOGO_BYTES } from "@/domain/friends/logo";
import { fixturePhoto } from "@/services/instagram-fixture";
import { compressLogo } from "./compress-logo";

describe("compressLogo", () => {
  it("shrinks a large picture into the box as one small WebP", async () => {
    const logo = await compressLogo(fixturePhoto("big logo", 900));
    expect(logo).not.toBeNull();
    if (!logo) return;
    expect(logo.contentType).toBe("image/webp");
    expect(Math.max(logo.width, logo.height)).toBe(LOGO_BOX);
    expect(logo.bytes.length).toBeLessThanOrEqual(MAX_STORED_LOGO_BYTES);
    expect(logo.sha256).toMatch(/^[0-9a-f]{64}$/);
    const meta = await sharp(logo.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("keeps a small picture's size and shape", async () => {
    const wide = await sharp({
      create: { width: 120, height: 40, channels: 4, background: "#ff6600" },
    })
      .png()
      .toBuffer();
    const logo = await compressLogo(wide);
    expect(logo).toMatchObject({ width: 120, height: 40 });
  });

  it("refuses bytes that aren't a picture", async () => {
    expect(await compressLogo(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});
