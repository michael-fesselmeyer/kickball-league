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

  it("tells a waitlisted player a spot opened, or that an event is called off", () => {
    const about = {
      title: "Spring kickoff BBQ",
      slug: "spring-kickoff-bbq-2027-04-10",
      when: "Sat, Apr 10, 12:00 PM – 4:00 PM",
      place: "McCarren Park, north picnic area",
    };
    const spot = render("event_notice", { ...about, kind: "spot_opened" });
    if (!spot.ok) throw new Error(spot.error);
    expect(spot.value.subject).toBe("You're in: Spring kickoff BBQ");
    expect(spot.value.text).toContain(
      "(Sat, Apr 10, 12:00 PM – 4:00 PM, McCarren Park, north picnic area)",
    );
    expect(spot.value.text).toContain(
      "https://league.example.test/app/events/spring-kickoff-bbq-2027-04-10",
    );
    expect(spot.value.text).toContain(
      "because you joined this event's waitlist",
    );

    const off = render("event_notice", {
      ...about,
      place: null,
      kind: "cancelled",
    });
    if (!off.ok) throw new Error(off.error);
    expect(off.value.subject).toBe("Called off: Spring kickoff BBQ");
    expect(off.value.text).toContain(
      "called off Spring kickoff BBQ (Sat, Apr 10, 12:00 PM – 4:00 PM).",
    );
    expect(off.value.text).toContain("https://league.example.test/events");
  });

  it("tells an event's audience about a new event or a change", () => {
    const about = {
      title: "Team mixer",
      slug: "team-mixer-2027-03-06",
      when: "Sat, Mar 6, 8:00 – 11:00 PM",
      place: "The Example Hall, 1 Example St",
      inviteUrl: "https://www.partiful.example.test/e/mixer",
    };
    const fresh = render("event_notice", { ...about, kind: "announced" });
    if (!fresh.ok) throw new Error(fresh.error);
    expect(fresh.value.subject).toBe("New event: Team mixer");
    expect(fresh.value.text).toContain(
      "RSVP on partiful.example.test: https://www.partiful.example.test/e/mixer",
    );
    // Not a public event: the link goes to the signed-in page.
    expect(fresh.value.text).toContain(
      "https://league.example.test/app/events/team-mixer-2027-03-06",
    );
    expect(fresh.value.text).toContain(
      "because the league posted an event for you",
    );

    const changed = render("event_notice", {
      ...about,
      inviteUrl: null,
      publicPage: true,
      kind: "updated",
    });
    if (!changed.ok) throw new Error(changed.error);
    expect(changed.value.subject).toBe("Update: Team mixer");
    expect(changed.value.text).not.toContain("RSVP on");
    expect(changed.value.text).toContain(
      "https://league.example.test/events/team-mixer-2027-03-06",
    );
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

  it("alerts admins to rain, linking the rain-out screen with the day chosen", () => {
    const alert = (level: "watch" | "likely", thunder: boolean) => {
      const result = render("rain_alert", {
        seasonName: "Fall 2026",
        seasonSlug: "fall-2026",
        date: "2026-09-13",
        day: "Sun, Sep 13",
        firstPitch: "1:00 PM",
        games: 6,
        level,
        peakChance: level === "likely" ? 78 : 52,
        thunder,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    const likely = alert("likely", true);
    expect(likely.subject).toBe("Rain likely Sun, Sep 13: Fall 2026");
    expect(likely.text).toContain(
      "Fall 2026 has 6 games on Sun, Sep 13, from 1:00 PM. Up to a 78% chance of rain while games are on, with thunderstorms in the forecast",
    );
    expect(likely.text).toContain(
      "Open the rain-out screen: https://league.example.test/app/admin/seasons/fall-2026/rainout?date=2026-09-13",
    );
    expect(likely.html).toContain("rainout?date=2026-09-13");
    const watch = alert("watch", false);
    expect(watch.subject).toBe("Rain watch Sun, Sep 13: Fall 2026");
    expect(watch.text).toContain(
      "Up to a 52% chance of rain while games are on, according",
    );
    expect(watch.text).toContain("you will get a second alert");
    expect(
      render("rain_alert", { seasonName: "Fall 2026", level: "low" }).ok,
    ).toBe(false);
  });

  it("asks admins to reconnect Instagram, saying the photos stay up", () => {
    const result = render("instagram_reconnect", {
      username: "league.example",
      reason: "Instagram no longer accepts the connection",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Reconnect Instagram (@league.example)");
    expect(result.value.text).toContain(
      "Instagram no longer accepts the connection, so new posts from @league.example have stopped syncing. The photos already on the site stay up.",
    );
    expect(result.value.text).toContain(
      "Reconnect Instagram: https://league.example.test/app/admin/instagram",
    );
    expect(render("instagram_reconnect", { username: "" }).ok).toBe(false);
  });

  it("tells admins the Instagram photo storage is full, and how to free it", () => {
    const result = render("instagram_storage_full", { capMegabytes: 25 });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("Instagram photo storage is full");
    expect(result.value.text).toContain("up to 25 MB of Instagram photos");
    expect(result.value.text).toContain("unfeature or hide older ones");
    expect(render("instagram_storage_full", { capMegabytes: 0 }).ok).toBe(
      false,
    );
  });

  const subGame = {
    seasonName: "Fall 2026",
    seasonSlug: "fall-2026",
    team: "Aces",
    teams: "Aces vs Bees",
    when: "Mon, Sep 14, 7:00 PM, Field 2",
  };

  it("renders a call for subs, saying why this player got it", () => {
    const call = (freeAgent: boolean) => {
      const result = render("sub_request", {
        ...subGame,
        spots: "2 subs, at least 1 woman",
        note: "Wear red",
        freeAgent,
      });
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    expect(call(true).subject).toBe(
      "Aces needs 2 subs, at least 1 woman: Mon, Sep 14, 7:00 PM, Field 2",
    );
    expect(call(true).text).toContain("From the captain: Wear red");
    expect(call(true).text).toContain(
      "See sub requests: https://league.example.test/app/subs",
    );
    expect(call(true).text).toContain("you are a free agent in Fall 2026");
    expect(call(false).text).toContain("your team is not playing at that time");
  });

  it("renders each answer to a sub offer", () => {
    const subjects = (
      ["claimed", "withdrawn", "approved", "declined", "cancelled"] as const
    ).map((kind) => {
      const result = render("sub_update", {
        ...subGame,
        kind,
        player: "Jo S.",
      });
      if (!result.ok) throw new Error(result.error);
      return result.value.subject;
    });
    expect(subjects).toEqual([
      "Jo S. wants to sub: Mon, Sep 14, 7:00 PM, Field 2",
      "Jo S. can't sub after all: Mon, Sep 14, 7:00 PM, Field 2",
      "You're subbing for Aces: Mon, Sep 14, 7:00 PM, Field 2",
      "Aces is covered: Mon, Sep 14, 7:00 PM, Field 2",
      "Aces no longer needs subs: Mon, Sep 14, 7:00 PM, Field 2",
    ]);
    const claimed = render("sub_update", {
      ...subGame,
      kind: "claimed",
      player: "Jo S.",
    });
    expect(claimed.ok && claimed.value.text).toContain(
      "https://league.example.test/app/seasons/fall-2026/team/subs",
    );
    // A claim notice without the player's name cannot be built.
    expect(render("sub_update", { ...subGame, kind: "claimed" }).ok).toBe(
      false,
    );
  });

  it("refuses an unknown template", () => {
    expect(render("nope", {})).toEqual({
      ok: false,
      error: "No email template named nope",
    });
  });
});

describe("the digest", () => {
  const items = [
    {
      title: "Field change Saturday",
      text: "We moved to Field 3.",
      path: "/app/seasons/fall-2026",
    },
    {
      title: "What was the final score?",
      text: "Aces vs Bees has no score yet.",
      path: "/app/games/g1/score",
    },
  ];

  it("lists each held message with a link, and says why it came", () => {
    const result = render("digest", { frequency: "daily", dailyCap: 3, items });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("League news: 2 updates");
    expect(result.value.text).toContain("- Field change Saturday");
    expect(result.value.text).toContain(
      "https://league.example.test/app/games/g1/score",
    );
    expect(result.value.text).toContain(
      "you get at most 3 league emails a day that can wait, and these came after that",
    );
    expect(result.value.text).toContain(
      "Change your daily limit, digest or quiet hours: https://league.example.test/app/profile#alert-limits",
    );
  });

  it("speaks to someone who wants everything in the digest", () => {
    const result = render("digest", {
      frequency: "weekly",
      dailyCap: 0,
      items: items.slice(0, 1),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe("League news: 1 update");
    expect(result.value.text).toContain("Your league news this week");
    expect(result.value.text).toContain(
      "you chose to get news that can wait in one weekly email",
    );
  });

  it("refuses an empty digest or a link off the site", () => {
    expect(
      render("digest", { frequency: "daily", dailyCap: 3, items: [] }).ok,
    ).toBe(false);
    expect(
      render("digest", {
        frequency: "daily",
        dailyCap: 3,
        items: [{ title: "x", text: "", path: "https://evil.example.test" }],
      }).ok,
    ).toBe(false);
  });
});
