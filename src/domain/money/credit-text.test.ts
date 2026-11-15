import { describe, expect, it } from "vitest";
import { describeCredit, formatMoment, moneyLine } from "./credit";

describe("moneyLine", () => {
  it("joins a card and a credit amount", () => {
    expect(moneyLine(1500, 500, "on your card", "of league credit")).toBe(
      "$15 on your card and $5 of league credit",
    );
  });

  it("leaves out whichever part is zero and is undefined when both are", () => {
    expect(moneyLine(1550, 0, "card", "credit")).toBe("$15.50 card");
    expect(moneyLine(0, 700, "card", "credit")).toBe("$7 credit");
    expect(moneyLine(0, 0, "card", "credit")).toBeUndefined();
  });
});

describe("formatMoment", () => {
  it("writes the time in the league's zone, across a date boundary", () => {
    const instant = new Date("2027-03-02T02:30:00Z");
    expect(formatMoment(instant, "America/New_York")).toBe(
      "Monday, March 1 at 9:30 PM",
    );
    expect(formatMoment(instant, "UTC")).toBe("Tuesday, March 2 at 2:30 AM");
  });
});

describe("describeCredit", () => {
  it("has plain words for every reason", () => {
    expect(describeCredit("referral")).toBe("Referral");
    expect(describeCredit("goodwill")).toBe("From the league");
    expect(describeCredit("released")).toBe(
      "Returned from an unfinished checkout",
    );
  });
});
