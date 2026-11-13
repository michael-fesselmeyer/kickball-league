import { describe, expect, it } from "vitest";
import {
  alignmentCenters,
  dataCodewords,
  encodeQr,
  formatBits,
  qrPath,
  reedSolomon,
  versionBits,
  versionFor,
} from "./encode";

describe("the QR encoder's building blocks", () => {
  it("computes Reed-Solomon codewords as in the standard's worked example", () => {
    // ISO/IEC 18004 annex I: "01234567" at 1-M.
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([
      165, 36, 212, 193, 237, 54, 199, 135, 44, 85,
    ]);
  });

  it("knows level M's capacity by version", () => {
    expect([1, 2, 5, 7, 10].map(dataCodewords)).toEqual([16, 28, 86, 124, 216]);
  });

  it("picks the smallest version that fits", () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(84)).toBe(5);
    expect(versionFor(213)).toBe(10);
    expect(versionFor(214)).toBeNull();
  });

  it("places alignment patterns where the standard's table does", () => {
    expect(alignmentCenters(1)).toEqual([]);
    expect(alignmentCenters(2)).toEqual([6, 18]);
    expect(alignmentCenters(7)).toEqual([6, 22, 38]);
    expect(alignmentCenters(10)).toEqual([6, 28, 50]);
  });

  it("writes the standard's format and version information", () => {
    // Level M with mask 0, and the table's entry for version 7.
    expect(formatBits(0).toString(2)).toBe("101010000010010");
    expect(versionBits(7)).toBe(0x07c94);
  });
});

describe("encodeQr", () => {
  const url = "https://league.example.test/app/check-in/the-corner-pocket/abcdefghjk";

  it("draws the finder patterns and the timing lines", () => {
    const code = encodeQr(url);
    expect(code.size).toBe(code.version * 4 + 17);
    const row = (y: number) =>
      code.modules[y]?.slice(0, 7).map((d) => (d ? 1 : 0)).join("");
    expect([0, 1, 2, 3, 4, 5, 6].map(row)).toEqual([
      "1111111",
      "1000001",
      "1011101",
      "1011101",
      "1011101",
      "1000001",
      "1111111",
    ]);
    for (let i = 8; i < code.size - 8; i++) {
      expect(code.modules[6]?.[i]).toBe(i % 2 === 0);
      expect(code.modules[i]?.[6]).toBe(i % 2 === 0);
    }
    // The dark module.
    expect(code.modules[code.size - 8]?.[8]).toBe(true);
  });

  it("is the same every time for the same text", () => {
    expect(encodeQr(url)).toEqual(encodeQr(url));
    expect(encodeQr(url)).not.toEqual(encodeQr(`${url}x`));
  });

  it("refuses text too long for version 10", () => {
    expect(() => encodeQr("x".repeat(300))).toThrow(/Too long/);
  });

  it("draws dark runs as one SVG path inside a quiet zone", () => {
    const path = qrPath(encodeQr("hi"));
    // The top-left finder's first row: seven dark modules from (4, 4).
    expect(path.startsWith("M4 4h7v1h-7z")).toBe(true);
  });
});
