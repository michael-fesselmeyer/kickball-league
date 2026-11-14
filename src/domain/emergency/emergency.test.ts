import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatPhone } from "../profile/profile-form";
import {
  cardsVisible,
  cardText,
  FIRST_AID_MAX,
  parseEmergencyForm,
  readCard,
  RELATIONSHIP_MAX,
  startOfNextDay,
  toEmergencyForm,
} from "./emergency";

const NY = "America/New_York";
const at = (iso: string) => new Date(iso);
// Tuesday Oct 6, 2026, 8 PM in New York.
const game = {
  status: "scheduled",
  startsAt: at("2026-10-07T00:00:00Z"),
  timeZone: NY,
};
const captain = { captainsGame: true, refereesGame: false };
const ref = { captainsGame: false, refereesGame: true };
const nobody = { captainsGame: false, refereesGame: false };

describe("who sees emergency contacts, and when", () => {
  it("shows the game's captains and ref all of game day in the league's zone", () => {
    for (const viewer of [captain, ref])
      for (const now of [
        "2026-10-06T04:00:00Z", // 12:00 AM in New York
        "2026-10-06T16:00:00Z",
        "2026-10-07T03:59:59Z", // 11:59 PM in New York
      ])
        expect(cardsVisible(game, viewer, at(now))).toEqual({
          ok: true,
          until: at("2026-10-07T04:00:00Z"),
        });
  });

  it("hides them the day before and the day after", () => {
    expect(cardsVisible(game, captain, at("2026-10-06T03:59:59Z"))).toEqual({
      ok: false,
      error: "not_game_day",
    });
    expect(cardsVisible(game, ref, at("2026-10-07T04:00:00Z"))).toEqual({
      ok: false,
      error: "not_game_day",
    });
  });

  it("never shows anyone else, admins included, even on game day", () => {
    expect(cardsVisible(game, nobody, at("2026-10-06T22:00:00Z"))).toEqual({
      ok: false,
      error: "not_yours",
    });
  });

  it("hides them for a game called off or not placed", () => {
    for (const changed of [
      { status: "cancelled" },
      { status: "postponed" },
      { startsAt: null },
    ])
      expect(
        cardsVisible(
          { ...game, ...changed },
          captain,
          at("2026-10-06T22:00:00Z"),
        ),
      ).toEqual({ ok: false, error: "called_off" });
  });

  it("is visible exactly when now falls on the kickoff's local date", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: at("2026-01-01T00:00:00Z"),
          max: at("2027-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        fc.integer({ min: -3 * 86_400_000, max: 3 * 86_400_000 }),
        (kickoff, offset) => {
          const now = new Date(kickoff.getTime() + offset);
          const day = (d: Date) =>
            d.toLocaleDateString("en-CA", { timeZone: NY });
          const shown = cardsVisible({ ...game, startsAt: kickoff }, ref, now);
          expect(shown.ok).toBe(day(now) === day(kickoff));
          if (shown.ok)
            expect(now.getTime()).toBeLessThan(shown.until.getTime());
        },
      ),
    );
  });
});

describe("the end of a local day", () => {
  it("is the next local midnight, across daylight-saving changes", () => {
    expect(startOfNextDay("2026-10-06", NY)).toEqual(
      at("2026-10-07T04:00:00Z"),
    );
    // Clocks go back on Nov 1, 2026: that day has 25 hours.
    expect(startOfNextDay("2026-10-31", NY)).toEqual(
      at("2026-11-01T04:00:00Z"),
    );
    expect(startOfNextDay("2026-11-01", NY)).toEqual(
      at("2026-11-02T05:00:00Z"),
    );
    // Clocks go forward on Mar 8, 2026.
    expect(startOfNextDay("2026-03-08", NY)).toEqual(
      at("2026-03-09T04:00:00Z"),
    );
    expect(startOfNextDay("2026-12-31", "UTC")).toEqual(
      at("2027-01-01T00:00:00Z"),
    );
  });
});

describe("the emergency contact form", () => {
  const form = {
    emergencyContactName: " Sam Example ",
    emergencyContactRelationship: "partner",
    emergencyContactPhone: "(718) 555-0199",
    firstAidNote: " Allergic to bee stings; EpiPen in the blue bag. ",
  };

  it("reads a contact with a relationship and a first-aid note", () => {
    expect(parseEmergencyForm(form, "+17185550142")).toEqual({
      ok: true,
      value: {
        name: "Sam Example",
        relationship: "partner",
        phone: "+17185550199",
        firstAid: "Allergic to bee stings; EpiPen in the blue bag.",
      },
    });
  });

  it("leaves the relationship and note out when blank", () => {
    const parsed = parseEmergencyForm(
      { ...form, emergencyContactRelationship: " ", firstAidNote: "" },
      null,
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      relationship: null,
      firstAid: null,
    });
  });

  it("needs a name and someone else's phone, and keeps notes short", () => {
    const errors = (f: Partial<typeof form>, own: string | null = null) => {
      const parsed = parseEmergencyForm({ ...form, ...f }, own);
      return parsed.ok ? {} : parsed.errors;
    };
    expect(errors({ emergencyContactName: "" })).toHaveProperty(
      "emergencyContactName",
    );
    expect(errors({ emergencyContactPhone: "call me" })).toHaveProperty(
      "emergencyContactPhone",
    );
    expect(errors({}, "+17185550199")).toHaveProperty("emergencyContactPhone");
    expect(
      errors({
        emergencyContactRelationship: "x".repeat(RELATIONSHIP_MAX + 1),
      }),
    ).toHaveProperty("emergencyContactRelationship");
    expect(
      errors({ firstAidNote: "x".repeat(FIRST_AID_MAX + 1) }),
    ).toHaveProperty("firstAidNote");
  });

  it("fills the form back from a saved card, or blanks", () => {
    const parsed = parseEmergencyForm(form, null);
    if (!parsed.ok) throw new Error("Expected a card");
    expect(toEmergencyForm(parsed.value, formatPhone)).toEqual({
      emergencyContactName: "Sam Example",
      emergencyContactRelationship: "partner",
      emergencyContactPhone: "(718) 555-0199",
      firstAidNote: "Allergic to bee stings; EpiPen in the blue bag.",
    });
    expect(toEmergencyForm(null, formatPhone).emergencyContactName).toBe("");
  });
});

describe("the sealed card's text", () => {
  it("reads back what was written, and nothing else", () => {
    const card = {
      name: "Sam Example",
      relationship: null,
      phone: "+17185550199",
      firstAid: "Asthma",
    };
    expect(readCard(cardText(card))).toEqual(card);
    for (const text of ["", "[]", "{}", '{"name":1,"phone":"+1"}', "not json"])
      expect(readCard(text)).toBeNull();
  });
});
