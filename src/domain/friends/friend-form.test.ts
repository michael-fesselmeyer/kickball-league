import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  BLANK_FRIEND_FORM,
  displayHost,
  type FriendForm,
  groupByActivity,
  MAX_URL_LENGTH,
  parseFriendForm,
  parseWebsite,
} from "./friend-form";

describe("parseWebsite", () => {
  it.each([
    ["https://slow-pitch.example.test", "https://slow-pitch.example.test/"],
    [
      "  https://slow-pitch.example.test/join  ",
      "https://slow-pitch.example.test/join",
    ],
    ["slow-pitch.example.test", "https://slow-pitch.example.test/"],
    [
      "HTTPS://Slow-Pitch.Example.Test/Sign-Up?x=1#top",
      "https://slow-pitch.example.test/Sign-Up?x=1#top",
    ],
    [
      "www.meeple-night.example.test/",
      "https://www.meeple-night.example.test/",
    ],
  ])("accepts %s as %s", (raw, url) => {
    expect(parseWebsite(raw)).toEqual({ ok: true, value: url });
  });

  it("refuses plain http with its own message", () => {
    expect(parseWebsite("http://slow-pitch.example.test")).toEqual({
      ok: false,
      error: "url_not_https",
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<p>hi</p>",
    "ftp://files.example.test/",
    "mailto:hello@example.test",
    "https://localhost/",
    "https://intranet/",
    "https://192.168.1.10/",
    "https://[::1]/",
    "https://user:secret@slow-pitch.example.test/",
    "https://slow-pitch.example.test:8443/",
    "https://slow pitch.example.test/",
    "https://slow-pitch.example.test./",
  ])("refuses %s", (raw) => {
    expect(parseWebsite(raw)).toEqual({ ok: false, error: "url_invalid" });
  });

  it("asks for a link when there is none", () => {
    expect(parseWebsite("   ")).toEqual({ ok: false, error: "url_missing" });
  });

  it("refuses an address too long to show", () => {
    const long = `https://example.test/${"a".repeat(MAX_URL_LENGTH)}`;
    expect(parseWebsite(long)).toEqual({ ok: false, error: "url_too_long" });
  });

  it("only ever returns https addresses on a named host", () => {
    fc.assert(
      fc.property(fc.oneof(fc.webUrl(), fc.string()), (raw) => {
        const parsed = parseWebsite(raw);
        if (!parsed.ok) return;
        const url = new URL(parsed.value);
        expect(url.protocol).toBe("https:");
        expect(url.hostname).toContain(".");
        expect(url.username + url.password + url.port).toBe("");
        expect(parsed.value.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
      }),
    );
  });
});

describe("parseFriendForm", () => {
  const form = (over: Partial<FriendForm> = {}): FriendForm => ({
    name: " Northside Sunday Soccer ",
    activity: "soccer",
    area: "  ",
    description: "",
    url: "northside-soccer.example.test",
    linksBack: true,
    ...over,
  });

  it("trims the fields and leaves blanks empty", () => {
    expect(parseFriendForm(form())).toEqual({
      ok: true,
      value: {
        name: "Northside Sunday Soccer",
        activity: "soccer",
        area: null,
        description: null,
        url: "https://northside-soccer.example.test/",
        linksBack: true,
      },
    });
  });

  it.each([
    [{ name: " " }, "name_missing"],
    [{ name: "x".repeat(81) }, "name_too_long"],
    [{ activity: "quidditch" }, "bad_activity"],
    [{ area: "x".repeat(81) }, "area_too_long"],
    [{ description: "x".repeat(281) }, "description_too_long"],
    [{ url: "" }, "url_missing"],
    [{ url: "http://northside-soccer.example.test" }, "url_not_https"],
  ] as const)("refuses %o with %s", (over, error) => {
    expect(parseFriendForm(form(over))).toEqual({ ok: false, error });
  });

  it("starts the blank form on a real activity", () => {
    expect(ACTIVITIES).toContain(BLANK_FRIEND_FORM.activity);
  });
});

describe("activities", () => {
  it("group entries in activity order, by name within a group", () => {
    const entries = [
      { name: "Rack 'Em Wednesdays", activity: "pool" as const },
      { name: "Zed's Softball", activity: "softball" as const },
      { name: "Apple Softball", activity: "softball" as const },
    ];
    expect(groupByActivity(entries)).toEqual([
      {
        activity: "softball",
        label: ACTIVITY_LABELS.softball,
        entries: [entries[2], entries[1]],
      },
      { activity: "pool", label: "Pool", entries: [entries[0]] },
    ]);
  });
});

describe("displayHost", () => {
  it("shows the host without www.", () => {
    expect(displayHost("https://www.meeple-night.example.test/join")).toBe(
      "meeple-night.example.test",
    );
  });
});
