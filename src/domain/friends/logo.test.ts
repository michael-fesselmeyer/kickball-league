import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkLogoUpload,
  logoFits,
  MAX_LOGO_UPLOAD_BYTES,
  MAX_STORED_LOGO_BYTES,
  MAX_TOTAL_LOGO_BYTES,
} from "./logo";

describe("checkLogoUpload", () => {
  it("takes PNG, JPEG and WebP up to the upload limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"])
      expect(checkLogoUpload({ size: MAX_LOGO_UPLOAD_BYTES, type })).toEqual({
        ok: true,
        value: null,
      });
  });

  it("refuses a larger file", () => {
    expect(
      checkLogoUpload({ size: MAX_LOGO_UPLOAD_BYTES + 1, type: "image/png" }),
    ).toEqual({ ok: false, error: "logo_too_large" });
  });

  it("refuses SVG and anything that isn't a picture", () => {
    for (const type of ["image/svg+xml", "text/html", "application/pdf", ""])
      expect(checkLogoUpload({ size: 100, type })).toEqual({
        ok: false,
        error: "logo_wrong_type",
      });
  });
});

describe("logoFits", () => {
  it("counts the logo being replaced as freed", () => {
    const full = MAX_TOTAL_LOGO_BYTES;
    expect(logoFits({ storedBytes: full, replacedBytes: 0, newBytes: 1 })).toBe(
      false,
    );
    expect(
      logoFits({ storedBytes: full, replacedBytes: 5000, newBytes: 5000 }),
    ).toBe(true);
  });

  it("refuses a single copy over its own cap", () => {
    expect(
      logoFits({
        storedBytes: 0,
        replacedBytes: 0,
        newBytes: MAX_STORED_LOGO_BYTES + 1,
      }),
    ).toBe(false);
  });

  it("never lets the store pass the total cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_TOTAL_LOGO_BYTES }),
        fc.integer({ min: 0, max: MAX_STORED_LOGO_BYTES }),
        fc.integer({ min: 1, max: 2 * MAX_STORED_LOGO_BYTES }),
        (storedBytes, replaced, newBytes) => {
          const replacedBytes = Math.min(replaced, storedBytes);
          if (logoFits({ storedBytes, replacedBytes, newBytes }))
            expect(storedBytes - replacedBytes + newBytes).toBeLessThanOrEqual(
              MAX_TOTAL_LOGO_BYTES,
            );
        },
      ),
    );
  });
});
