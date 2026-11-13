import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkFile,
  DAILY_UPLOADS,
  fitsLeagueCap,
  LEAGUE_CAP_BYTES,
  leagueStorageFull,
  MAX_STORED_BYTES,
  MAX_UPLOAD_BYTES,
  sniff,
  underDailyLimit,
  UPLOAD_MESSAGES,
} from "./limits";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );
const pad = (n: number) => Array.from({ length: n }, () => 0);

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], pad(20));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pad(20));
const WEBP = bytes("RIFF", pad(4), "WEBPVP8 ", pad(20));
const ftyp = (brand: string) => bytes(pad(3), [0x20], "ftyp", brand, pad(20));

describe("sniff", () => {
  it("tells the three image types apart by their bytes", () => {
    expect(sniff(JPEG)).toBe("image/jpeg");
    expect(sniff(PNG)).toBe("image/png");
    expect(sniff(WEBP)).toBe("image/webp");
  });

  it("recognizes iPhone HEIC photos and videos", () => {
    expect(sniff(ftyp("heic"))).toBe("heic");
    expect(sniff(ftyp("mif1"))).toBe("heic");
    expect(sniff(ftyp("isom"))).toBe("video");
    expect(sniff(ftyp("qt  "))).toBe("video");
    expect(sniff(ftyp("mp42"))).toBe("video");
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3], pad(10)))).toBe("video");
    expect(sniff(bytes("RIFF", pad(4), "AVI ", pad(10)))).toBe("video");
    expect(sniff(ftyp("avif"))).toBe("other");
  });

  it("ignores what a file claims to be", () => {
    expect(sniff(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
      "other",
    );
    expect(sniff(bytes("GIF89a", pad(10)))).toBe("other");
    expect(sniff(bytes("%PDF-1.7"))).toBe("other");
    // Too short to hold a signature.
    expect(sniff(bytes([0xff, 0xd8]))).toBe("other");
    expect(sniff(bytes("RIFF"))).toBe("other");
  });

  it("never throws on any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (b) => {
        expect([
          "image/jpeg",
          "image/png",
          "image/webp",
          "heic",
          "video",
          "other",
        ]).toContain(sniff(b));
      }),
    );
  });
});

describe("checkFile", () => {
  it("accepts an image within the size limit", () => {
    expect(checkFile(JPEG)).toEqual({ ok: true, value: "image/jpeg" });
    expect(checkFile(WEBP)).toEqual({ ok: true, value: "image/webp" });
  });

  it("refuses empty, oversized, video, HEIC and other files", () => {
    expect(checkFile(new Uint8Array())).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(JPEG);
    expect(checkFile(big)).toEqual({ ok: false, error: "too_large" });
    expect(checkFile(ftyp("isom"))).toEqual({ ok: false, error: "video" });
    expect(checkFile(ftyp("heic"))).toEqual({ ok: false, error: "heic" });
    expect(checkFile(bytes("hello"))).toEqual({
      ok: false,
      error: "not_image",
    });
  });
});

describe("limits", () => {
  it("allows DAILY_UPLOADS a day and no more", () => {
    expect(underDailyLimit(0)).toBe(true);
    expect(underDailyLimit(DAILY_UPLOADS - 1)).toBe(true);
    expect(underDailyLimit(DAILY_UPLOADS)).toBe(false);
  });

  it("fits photos up to the league cap exactly", () => {
    expect(fitsLeagueCap(0, MAX_STORED_BYTES)).toBe(true);
    expect(fitsLeagueCap(LEAGUE_CAP_BYTES - 10, 10)).toBe(true);
    expect(fitsLeagueCap(LEAGUE_CAP_BYTES - 10, 11)).toBe(false);
  });

  it("closes uploads once the largest photo might not fit", () => {
    expect(leagueStorageFull(0)).toBe(false);
    expect(leagueStorageFull(LEAGUE_CAP_BYTES - MAX_STORED_BYTES)).toBe(false);
    expect(leagueStorageFull(LEAGUE_CAP_BYTES - MAX_STORED_BYTES + 1)).toBe(
      true,
    );
    // Whenever uploads are open, any stored photo fits.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: LEAGUE_CAP_BYTES }),
        fc.integer({ min: 1, max: MAX_STORED_BYTES }),
        (used, size) => {
          if (!leagueStorageFull(used))
            expect(fitsLeagueCap(used, size)).toBe(true);
        },
      ),
    );
  });

  it("explains every problem, with the numbers people need", () => {
    for (const message of Object.values(UPLOAD_MESSAGES))
      expect(message.length).toBeGreaterThan(10);
    expect(UPLOAD_MESSAGES.league_full).toContain("100 MB");
    expect(UPLOAD_MESSAGES.daily_cap).toContain(String(DAILY_UPLOADS));
    expect(UPLOAD_MESSAGES.too_large).toContain("4 MB");
  });
});
