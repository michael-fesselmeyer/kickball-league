import { describe, expect, it } from "vitest";
import {
  alignmentPositions,
  dataCodewords,
  dataFor,
  formatBits,
  qrMatrix,
  qrSvgPath,
  reedSolomon,
} from "./qr";

describe("reedSolomon", () => {
  it("matches the standard's worked example for version 1-M", () => {
    // "HELLO WORLD" in alphanumeric mode, version 1-M, as data codewords.
    const data = [
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ];
    expect(reedSolomon(data, 10)).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });
});

describe("formatBits", () => {
  it("matches the standard's table for level M", () => {
    expect(formatBits(0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits(7).toString(2).padStart(15, "0")).toBe("100101010100000");
  });
});

describe("capacity and layout", () => {
  it("holds the standard's data codewords at level M", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(dataCodewords)).toEqual([
      16, 28, 44, 64, 86, 108, 124, 154, 182, 216,
    ]);
  });

  it("puts alignment patterns where the standard does", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(10)).toEqual([6, 28, 50]);
  });

  it("encodes bytes with mode, length, terminator and padding", () => {
    const words = dataFor(new TextEncoder().encode("ab"), 1);
    expect(words).toHaveLength(16);
    // 0100, then length 00000010, then 'a' (0x61) and 'b' (0x62).
    expect(words.slice(0, 4)).toEqual([0x40, 0x26, 0x16, 0x20]);
    expect(words.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });
});

describe("qrMatrix", () => {
  const link =
    "https://league.example.test/app/games/5ea50000-0000-4000-8000-000000000001/score";

  it("picks the smallest version that holds the text", () => {
    expect(qrMatrix("hi")).toHaveLength(21);
    // 80 bytes need version 5 (86 data codewords at level M): 37 modules.
    expect(qrMatrix(link)).toHaveLength(37);
  });

  it("draws the three finder patterns, the timing lines and the dark module", () => {
    const m = qrMatrix(link);
    const n = m.length;
    const finderRow = [true, true, true, true, true, true, true, false];
    expect(m[0]?.slice(0, 8)).toEqual(finderRow);
    expect(m[0]?.slice(n - 8).reverse()).toEqual(finderRow);
    expect(m[n - 1]?.slice(0, 8)).toEqual(finderRow);
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]?.[i]).toBe(i % 2 === 0);
      expect(m[i]?.[6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8]?.[8]).toBe(true);
  });

  it("refuses text longer than version 10 holds", () => {
    expect(() => qrMatrix("x".repeat(300))).toThrow(/too long/);
  });
});

describe("qrSvgPath", () => {
  it("draws a square per dark module inside a four-module quiet zone", () => {
    const { path, viewBox } = qrSvgPath([
      [true, false],
      [false, true],
    ]);
    expect(viewBox).toBe("0 0 10 10");
    expect(path).toBe("M4 4h1v1h-1zM5 5h1v1h-1z");
  });
});
