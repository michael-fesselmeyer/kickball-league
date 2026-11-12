import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkWaiverDraft,
  hashWaiverBody,
  normalizeWaiverBody,
  signatureMatches,
  waiverBlocks,
} from "./waiver";

describe("hashWaiverBody", () => {
  it("is a stable SHA-256 of the normalized text", () => {
    expect(hashWaiverBody("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashWaiverBody("Line one\r\nLine two  \n\n")).toBe(
      hashWaiverBody("Line one\nLine two"),
    );
    expect(hashWaiverBody("Line one")).not.toBe(hashWaiverBody("Line 1"));
  });

  it("ignores line endings and trailing space, for any text", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 8 }), (lines) => {
        expect(normalizeWaiverBody(lines.join("\r\n"))).toBe(
          normalizeWaiverBody(lines.map((l) => `${l}  `).join("\n")),
        );
      }),
    );
  });
});

describe("signatureMatches", () => {
  it("accepts the full name, ignoring case, accents and spacing", () => {
    expect(signatureMatches("robin example", "Robin", "Example")).toBe(true);
    expect(signatureMatches("  Zoë   O'Neil ", "Zoe", "O Neil")).toBe(true);
    expect(signatureMatches("Robin Q. Example", "Robin", "Example")).toBe(true);
    expect(signatureMatches("Mary Ann van Dyke", "Mary Ann", "van Dyke")).toBe(
      true,
    );
  });

  it("refuses a partial or different name", () => {
    expect(signatureMatches("Robin", "Robin", "Example")).toBe(false);
    expect(signatureMatches("Example Robin", "Robin", "Example")).toBe(false);
    expect(signatureMatches("Sam Example", "Robin", "Example")).toBe(false);
    expect(signatureMatches("Robin Example", "", "Example")).toBe(false);
  });
});

describe("waiverBlocks", () => {
  it("reads headings, lists and paragraphs, keeping HTML as text", () => {
    expect(
      waiverBlocks(
        "# Release\n\nI agree to\nthe rules.\n\n- one\n* two\n\n<script>x</script>\n\n\n",
      ),
    ).toEqual([
      { kind: "heading", text: "Release" },
      { kind: "paragraph", text: "I agree to the rules." },
      { kind: "list", items: ["one", "two"] },
      { kind: "paragraph", text: "<script>x</script>" },
    ]);
    expect(waiverBlocks("")).toEqual([]);
  });
});

describe("checkWaiverDraft", () => {
  it("needs a title and the full text", () => {
    const body = "x".repeat(200);
    expect(checkWaiverDraft("Release", body)).toEqual({});
    expect(checkWaiverDraft(" ", body)).toHaveProperty("title");
    expect(checkWaiverDraft("Release", "short")).toHaveProperty("body");
    expect(checkWaiverDraft("Release", "x".repeat(50_001))).toHaveProperty(
      "body",
    );
  });
});
