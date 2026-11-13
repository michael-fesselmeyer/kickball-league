import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

const text = (name: string, payload: Record<string, unknown>) => {
  const result = render(name, payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("money emails", () => {
  it("warns a captain before charging the guarantee card", () => {
    const email = text("guarantee_warning", {
      teamName: "Kick Bottom",
      seasonName: "Spring 2027",
      seasonSlug: "spring-2027",
      balance: "$750",
      chargeOn: "Monday, March 1 at 12:00 AM",
      card: "Visa ending 4242",
    });
    expect(email.subject).toBe(
      "Kick Bottom still owes $750: your card is charged Monday, March 1 at 12:00 AM",
    );
    expect(email.text).toContain("your Visa ending 4242 will be charged");
    expect(email.text).toContain(
      "https://league.example.test/app/seasons/spring-2027/team",
    );
  });

  it("tells a captain their card was declined", () => {
    const email = text("guarantee_failed", {
      teamName: "Kick Bottom",
      seasonName: "Spring 2027",
      seasonSlug: "spring-2027",
      balance: "$750",
    });
    expect(email.subject).toBe("We couldn't charge your card for Kick Bottom");
  });

  it("offers a waitlisted captain a spot until a time", () => {
    const email = text("waitlist_offer", {
      seasonName: "Spring 2027",
      seasonSlug: "spring-2027",
      expires: "Friday, February 12 at 12:00 PM",
    });
    expect(email.subject).toContain("It's yours until Friday, February 12");
    expect(email.text).toContain(
      "https://league.example.test/app/seasons/spring-2027/register",
    );
  });

  it("announces referral and rebate credit", () => {
    expect(
      text("referral_credit", { amount: "$10", seasonName: "Spring 2027" })
        .subject,
    ).toBe("You earned $10 in league credit");
    const rebate = text("rebate_credit", {
      amount: "$63.75",
      seasonName: "Fall 2026",
      teamName: "Aces",
      gamesLost: 3,
      gamesCount: 8,
    });
    expect(rebate.text).toContain("Aces lost 3 of 8 games in Fall 2026");
  });

  it("refuses a payload that does not match", () => {
    expect(render("waitlist_offer", { seasonName: "x" }).ok).toBe(false);
  });
});
