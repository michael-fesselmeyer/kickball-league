import { describe, expect, it } from "vitest";
import {
  cents,
  MAX_PRICE_CENTS,
  parseAcceptance,
  parseRequest,
  privateSeasonSlug,
} from "./request";
import { isPublicSeason } from "./visibility";

const request = {
  kind: "tournament",
  organization: "  Example   Widgets Co ",
  teams: "6",
  preferredDates: "A Saturday in May",
  note: "Line one\nLine two",
};

describe("a booking request", () => {
  it("tidies the organization's words and keeps the note's lines", () => {
    expect(parseRequest(request)).toEqual({
      ok: true,
      value: {
        kind: "tournament",
        organization: "Example Widgets Co",
        teams: 6,
        preferredDates: "A Saturday in May",
        note: "Line one\nLine two",
      },
    });
    expect(parseRequest({ ...request, note: "   " })).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });

  it("names what's wrong", () => {
    expect(parseRequest({ ...request, kind: "party" })).toEqual({
      ok: false,
      error: "bad_kind",
    });
    expect(parseRequest({ ...request, organization: " " })).toMatchObject({
      error: "no_organization",
    });
    for (const teams of ["1", "33", "4.5", "", "many"])
      expect(parseRequest({ ...request, teams })).toMatchObject({
        error: "bad_teams",
      });
    expect(parseRequest({ ...request, preferredDates: "" })).toMatchObject({
      error: "no_dates",
    });
    expect(parseRequest({ ...request, note: "x".repeat(2001) })).toMatchObject({
      error: "too_long",
    });
  });
});

const acceptance = {
  name: "Example Widgets Tournament",
  startsOn: "2027-05-08",
  endsOn: "",
  payer: "organization",
  amount: "$1,200.50",
  gamesPerTeamPerDay: "2",
};

describe("accepting a request", () => {
  it("bills the organization once, for a one-day event by default", () => {
    expect(parseAcceptance(acceptance)).toEqual({
      ok: true,
      value: {
        name: "Example Widgets Tournament",
        startsOn: "2027-05-08",
        endsOn: "2027-05-08",
        payer: "organization",
        priceCents: 120_050,
        playerFeeCents: null,
        gamesPerTeamPerDay: 2,
      },
    });
  });

  it("or charges each player the fee", () => {
    expect(
      parseAcceptance({ ...acceptance, payer: "players", amount: "45" }),
    ).toMatchObject({
      ok: true,
      value: { priceCents: null, playerFeeCents: 4500 },
    });
  });

  it("refuses dates out of order, unknown payers and amounts that aren't money", () => {
    expect(
      parseAcceptance({ ...acceptance, endsOn: "2027-05-01" }),
    ).toMatchObject({ error: "bad_dates" });
    expect(parseAcceptance({ ...acceptance, startsOn: "May 8" })).toMatchObject(
      { error: "bad_dates" },
    );
    expect(parseAcceptance({ ...acceptance, payer: "sponsor" })).toMatchObject({
      error: "bad_payer",
    });
    expect(parseAcceptance({ ...acceptance, amount: "-5" })).toMatchObject({
      error: "bad_amount",
    });
    expect(
      parseAcceptance({ ...acceptance, gamesPerTeamPerDay: "3" }),
    ).toMatchObject({ error: "bad_games_per_day" });
    expect(parseAcceptance({ ...acceptance, name: "" })).toMatchObject({
      error: "no_name",
    });
  });

  it("reads dollars as typed, up to the cap", () => {
    expect(cents("450")).toBe(45_000);
    expect(cents("0")).toBe(0);
    expect(cents("12.5")).toBe(1250);
    expect(cents("12.345")).toBeNull();
    expect(cents((MAX_PRICE_CENTS / 100 + 1).toString())).toBeNull();
  });
});

describe("private seasons", () => {
  it("get a slug from the organization and the first day", () => {
    expect(privateSeasonSlug("Ácme Corp & Co.", "2027-05-08")).toBe(
      "private-acme-corp-co-2027-05-08",
    );
    expect(privateSeasonSlug("!!!", "2027-05-08")).toBe(
      "private-event-2027-05-08",
    );
    expect(privateSeasonSlug("a".repeat(80), "2027-05-08")).toHaveLength(
      "private-".length + 40 + "-2027-05-08".length,
    );
  });

  it("never count as public, whatever their status", () => {
    for (const status of ["registration_open", "in_progress", "completed"]) {
      expect(isPublicSeason({ status, visibility: "private" })).toBe(false);
      expect(isPublicSeason({ status, visibility: "league" })).toBe(true);
    }
    expect(isPublicSeason({ status: "draft", visibility: "league" })).toBe(
      false,
    );
  });
});
