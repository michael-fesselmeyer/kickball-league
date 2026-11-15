import { describe, expect, it } from "vitest";
import {
  checkClaim,
  cleanMessage,
  cleanPost,
  daysLeft,
  DESCRIPTION_MAX,
  expiresAt,
  firstName,
  ITEM_LIFE_DAYS,
  MAX_OPEN_CLAIMS,
  underDailyPostLimit,
} from "./rules";

const found = {
  kind: "found" as const,
  description: "  Black   cleats ",
  place: "Field 3",
  whereNow: "With me",
};

describe("cleanPost", () => {
  it("tidies spaces and keeps where a found item is now", () => {
    expect(cleanPost(found)).toEqual({
      ok: true,
      value: {
        kind: "found",
        description: "Black cleats",
        place: "Field 3",
        whereNow: "With me",
      },
    });
  });

  it("needs a description, a place and, for a found item, where it is now", () => {
    expect(cleanPost({ ...found, description: " " })).toEqual({
      ok: false,
      error: "no_description",
    });
    expect(cleanPost({ ...found, place: "" })).toEqual({
      ok: false,
      error: "no_place",
    });
    expect(cleanPost({ ...found, whereNow: "" })).toEqual({
      ok: false,
      error: "where_now_needed",
    });
  });

  it("drops where it is now from a lost note", () => {
    const r = cleanPost({ ...found, kind: "lost", whereNow: "ignored" });
    expect(r.ok && r.value.whereNow).toBeNull();
    expect(cleanPost({ ...found, kind: "lost", whereNow: "" }).ok).toBe(true);
  });

  it("refuses over-long text", () => {
    expect(
      cleanPost({ ...found, description: "x".repeat(DESCRIPTION_MAX + 1) }),
    ).toEqual({ ok: false, error: "description_too_long" });
    expect(cleanPost({ ...found, place: "x".repeat(81) })).toEqual({
      ok: false,
      error: "place_too_long",
    });
    expect(cleanPost({ ...found, whereNow: "x".repeat(121) })).toEqual({
      ok: false,
      error: "where_now_too_long",
    });
  });
});

describe("checkClaim", () => {
  const base = {
    posterId: "a",
    responderId: "b",
    status: "open" as const,
    earlier: null,
    openClaims: 0,
  };

  it("allows a first answer from someone else on an open post", () => {
    expect(checkClaim(base).ok).toBe(true);
  });

  it("refuses the poster, a closed post, a second answer and a crowded post", () => {
    expect(checkClaim({ ...base, responderId: "a" })).toEqual({
      ok: false,
      error: "own_post",
    });
    expect(checkClaim({ ...base, status: "returned" })).toEqual({
      ok: false,
      error: "not_open",
    });
    expect(checkClaim({ ...base, earlier: "withdrawn" })).toEqual({
      ok: false,
      error: "already_answered",
    });
    expect(checkClaim({ ...base, openClaims: MAX_OPEN_CLAIMS })).toEqual({
      ok: false,
      error: "too_many",
    });
  });
});

describe("messages and dates", () => {
  it("trims a message and refuses empty or long ones", () => {
    expect(cleanMessage("  hi  ")).toEqual({ ok: true, value: "hi" });
    expect(cleanMessage(" \n ")).toEqual({ ok: false, error: "empty" });
    expect(cleanMessage("x".repeat(501))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("counts days left up to the 30-day close, never below zero", () => {
    const posted = new Date("2026-10-01T12:00:00Z");
    expect(expiresAt(posted).getTime() - posted.getTime()).toBe(
      ITEM_LIFE_DAYS * 86_400_000,
    );
    expect(daysLeft(posted, posted)).toBe(30);
    expect(daysLeft(posted, new Date("2026-10-30T13:00:00Z"))).toBe(1);
    expect(daysLeft(posted, new Date("2027-01-01T00:00:00Z"))).toBe(0);
  });

  it("limits daily posts and shows first names only", () => {
    expect(underDailyPostLimit(4)).toBe(true);
    expect(underDailyPostLimit(5)).toBe(false);
    expect(firstName("Sam  Rivera")).toBe("Sam");
    expect(firstName("  ")).toBe("A member");
  });
});
