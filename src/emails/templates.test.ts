import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

const announcement = {
  subject: "Field change Saturday",
  body: "We moved to Field 3.\n\nBring water.",
  from: "League admins",
  seasonName: "Fall 2026",
  seasonSlug: "fall-2026",
};

describe("rendererFor", () => {
  it("renders a league-wide announcement", () => {
    const result = render("announcement", announcement);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Field change Saturday");
    expect(result.value.text).toContain("We moved to Field 3.\n\nBring water.");
    expect(result.value.text).toContain("— League admins");
    expect(result.value.text).toContain(
      "because you are registered for Fall 2026",
    );
    expect(result.value.text).toContain(
      "https://league.example.test/app/seasons/fall-2026",
    );
  });

  it("says which team a team announcement went to", () => {
    const result = render("announcement", {
      ...announcement,
      from: "Sam, captain of Kick Assets",
      teamName: "Kick Assets",
    });
    expect(result.ok && result.value.text).toContain(
      "because you play on Kick Assets in Fall 2026",
    );
  });

  it("renders a rain-out notice with the makeup, or says it has none yet", () => {
    const notice = {
      seasonName: "Fall 2026",
      seasonSlug: "fall-2026",
      teams: "Aces vs Bees",
      was: "Sun, Sep 6, 7:00 PM, Field 1",
      makeup: "Sun, Sep 20, 8:00 PM, Field 1",
    };
    const moved = render("rainout_notice", notice);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.value.subject).toBe(
      "Rained out: Aces vs Bees moves to Sun, Sep 20, 8:00 PM, Field 1",
    );
    expect(moved.value.text).toContain(
      "Aces vs Bees (Sun, Sep 6, 7:00 PM, Field 1) is rained out.",
    );
    expect(moved.value.text).toContain(
      "https://league.example.test/app/seasons/fall-2026",
    );
    expect(moved.value.text).toContain(
      "because you play in this game in Fall 2026",
    );

    const waiting = render("rainout_notice", { ...notice, makeup: null });
    if (!waiting.ok) throw new Error(waiting.error);
    expect(waiting.value.subject).toBe("Rained out: Aces vs Bees is postponed");
    expect(waiting.value.text).toContain("no makeup time yet");
  });

  it("refuses a payload that does not match its template", () => {
    expect(render("announcement", { subject: "Hi" })).toEqual({
      ok: false,
      error: "The message payload does not match its template",
    });
  });

  it("renders a payment reminder for the days left", () => {
    const remind = (daysLeft: number, needsWaiver = false) => {
      const result = render("payment_reminder", {
        seasonName: "Fall 2026",
        seasonSlug: "fall-2026",
        deadline: "Friday, September 11 at 11:59 PM",
        daysLeft,
        needsWaiver,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    expect(remind(7).subject).toBe("Your Fall 2026 fee is due in 7 days");
    expect(remind(1).subject).toBe("Your Fall 2026 fee is due tomorrow");
    expect(remind(0).subject).toBe("Your Fall 2026 fee is due today");
    expect(remind(3).text).toContain(
      "Pay now: https://league.example.test/app/seasons/fall-2026",
    );
    expect(remind(3, true).text).toContain("Sign the season waiver first");
  });

  it("asks the ref, then the captains, for a missing score", () => {
    const remind = (role: "referee" | "captain") => {
      const result = render("score_reminder", {
        gameId: "game-1",
        teams: "Aces vs Bees",
        when: "Sun, Sep 13, 7:00 PM, Field 2",
        role,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    expect(remind("referee").subject).toBe("Score needed: Aces vs Bees");
    expect(remind("referee").text).toContain("because you refereed this game");
    expect(remind("captain").text).toContain(
      "because you captain one of the teams in this game",
    );
    expect(remind("captain").text).toContain(
      "Enter the score: https://league.example.test/app/games/game-1/score",
    );
  });

  it("refuses an unknown template", () => {
    expect(render("nope", {})).toEqual({
      ok: false,
      error: "No email template named nope",
    });
  });
});
