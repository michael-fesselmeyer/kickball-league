import { describe, expect, it } from "vitest";
import {
  checkConductDraft,
  DEFAULT_CONDUCT_BODY,
  DEFAULT_CONDUCT_TITLE,
  hashConductBody,
} from "./conduct";

describe("checkConductDraft", () => {
  it("accepts the default sections as a starting point", () => {
    expect(
      checkConductDraft(DEFAULT_CONDUCT_TITLE, DEFAULT_CONDUCT_BODY),
    ).toEqual({});
  });

  it("covers the sections the league needs", () => {
    for (const heading of [
      "# Play",
      "# Sharing the park",
      "# Alcohol, glass and sound",
      "# Leave no trace",
      "# Online",
    ])
      expect(DEFAULT_CONDUCT_BODY).toContain(heading);
  });

  it("needs a title of up to 120 characters and a body of a sensible size", () => {
    expect(checkConductDraft("  ", DEFAULT_CONDUCT_BODY).title).toBeDefined();
    expect(
      checkConductDraft("x".repeat(121), DEFAULT_CONDUCT_BODY).title,
    ).toBeDefined();
    expect(checkConductDraft("Code", "too short").body).toBeDefined();
    expect(checkConductDraft("Code", "x".repeat(20_001)).body).toBeDefined();
  });
});

describe("hashConductBody", () => {
  it("ignores line endings and trailing space, and changes with the words", () => {
    expect(hashConductBody("a  \r\nb")).toBe(hashConductBody("a\nb"));
    expect(hashConductBody("a\nb")).not.toBe(hashConductBody("a\nc"));
    expect(hashConductBody("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
