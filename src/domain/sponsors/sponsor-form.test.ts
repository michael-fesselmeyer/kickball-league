import { describe, expect, it } from "vitest";
import { parseSponsorForm } from "./sponsor-form";

const form = {
  name: "  The Corner Pocket ",
  slug: "",
  kind: "bar",
  homeBar: true,
  blurb: "",
  address: "",
  url: "",
};

describe("the sponsor form", () => {
  it("makes the page address from the name when none is given", () => {
    expect(parseSponsorForm(form)).toEqual({
      ok: true,
      value: {
        name: "The Corner Pocket",
        slug: "the-corner-pocket",
        kind: "bar",
        isHomeBar: true,
        blurb: null,
        address: null,
        url: null,
      },
    });
    const custom = parseSponsorForm({ ...form, slug: "Corner Pocket!" });
    expect(custom.ok && custom.value.slug).toBe("corner-pocket");
  });

  it("adds https:// to a bare website and refuses plain http", () => {
    const bare = parseSponsorForm({
      ...form,
      url: "corner-pocket.example.test",
    });
    expect(bare.ok && bare.value.url).toBe(
      "https://corner-pocket.example.test/",
    );
    expect(parseSponsorForm({ ...form, url: "http://x.example.test" })).toEqual(
      {
        ok: false,
        error: "bad_url",
      },
    );
    expect(parseSponsorForm({ ...form, url: "javascript:alert(1)" })).toEqual({
      ok: false,
      error: "bad_url",
    });
    expect(parseSponsorForm({ ...form, url: "not a site" })).toEqual({
      ok: false,
      error: "bad_url",
    });
  });

  it("treats an unknown kind as a bar", () => {
    const parsed = parseSponsorForm({ ...form, kind: "casino" });
    expect(parsed.ok && parsed.value.kind).toBe("bar");
  });

  it("names what is wrong", () => {
    expect(parseSponsorForm({ ...form, name: " " })).toEqual({
      ok: false,
      error: "name_missing",
    });
    expect(parseSponsorForm({ ...form, name: "x".repeat(81) })).toEqual({
      ok: false,
      error: "name_too_long",
    });
    expect(parseSponsorForm({ ...form, slug: "!!!" })).toEqual({
      ok: false,
      error: "bad_slug",
    });
    expect(parseSponsorForm({ ...form, blurb: "x".repeat(501) })).toEqual({
      ok: false,
      error: "blurb_too_long",
    });
    expect(parseSponsorForm({ ...form, address: "x".repeat(201) })).toEqual({
      ok: false,
      error: "address_too_long",
    });
  });
});
