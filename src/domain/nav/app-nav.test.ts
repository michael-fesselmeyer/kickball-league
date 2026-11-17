import { describe, expect, it } from "vitest";
import { appNav, type NavInput, type NavSeason } from "./app-nav";

const NOBODY: NavInput = {
  seasons: [],
  plays: false,
  isReferee: false,
  isAdmin: false,
  isOwner: false,
  ownerDashboard: false,
  books: false,
  sponsor: false,
  photos: false,
  member: false,
  pickem: true,
  awards: true,
  leagueBase: "",
};

const fall = (over: Partial<NavSeason> = {}): NavSeason => ({
  seasonSlug: "fall-2026",
  seasonName: "Fall 2026",
  teamName: "The Big Kicks",
  role: "player",
  ...over,
});

const player: NavInput = {
  ...NOBODY,
  seasons: [fall()],
  plays: true,
  photos: true,
  member: true,
};

const titles = (input: NavInput) => appNav(input).groups.map((g) => g.title);
const hrefs = (input: NavInput) =>
  appNav(input).groups.flatMap((g) => g.links.map((l) => l.href));

describe("appNav", () => {
  it("gives a player tabs to home, their schedule and their team", () => {
    expect(appNav(player).tabs).toEqual([
      { href: "/app", label: "Home", icon: "home" },
      {
        href: "/seasons/fall-2026/schedule",
        label: "Schedule",
        icon: "schedule",
      },
      { href: "/app/seasons/fall-2026/team", label: "Team", icon: "team" },
    ]);
  });

  it("groups a player's menu without any staff group", () => {
    expect(titles(player)).toEqual([
      "My season",
      "Game day",
      "League life",
      "Help",
      "Account",
    ]);
    expect(hrefs(player)).not.toContain("/app/admin");
    expect(hrefs(player)).not.toContain("/app/referee");
    expect(hrefs(player)).not.toContain(
      "/app/seasons/fall-2026/team/announcements",
    );
  });

  it("adds a Captain group for a captain or co-captain", () => {
    for (const role of ["captain", "co_captain"] as const) {
      const nav = appNav({ ...player, seasons: [fall({ role })] });
      const captain = nav.groups.find((g) => g.id === "captain");
      expect(captain?.links.map((l) => l.label)).toEqual([
        "Roster and payments",
        "Message your team",
        "Attendance",
        "Find subs",
        "Scheduling requests",
      ]);
    }
  });

  it("names each team when someone captains two", () => {
    const nav = appNav({
      ...player,
      seasons: [
        fall({ role: "captain" }),
        fall({
          seasonSlug: "winter-2027",
          seasonName: "Winter 2027",
          teamName: "Snow Kicks",
          role: "captain",
        }),
      ],
    });
    expect(nav.groups.map((g) => g.title)).toContain("Captain: Snow Kicks");
    expect(nav.groups.map((g) => g.title)).toContain("Captain: The Big Kicks");
    // The Team tab opens the season being played, not the next one.
    expect(nav.tabs[2]?.href).toBe("/app/seasons/fall-2026/team");
  });

  it("gives an admin who refs both groups", () => {
    const t = titles({ ...player, isAdmin: true, isReferee: true });
    expect(t).toContain("Referee");
    expect(t).toContain("League admin");
    expect(t).not.toContain("Owner");
  });

  it("gives an admin with no team no player items, and an Admin tab", () => {
    const admin: NavInput = { ...NOBODY, isAdmin: true, member: true };
    const nav = appNav(admin);
    expect(nav.tabs.map((t) => t.label)).toEqual(["Home", "Schedule", "Admin"]);
    expect(nav.tabs[1]?.href).toBe("/seasons");
    expect(titles(admin)).toEqual([
      "League admin",
      "League life",
      "Help",
      "Account",
    ]);
    expect(hrefs(admin)).not.toContain("/app/subs");
    expect(hrefs(admin)).not.toContain("/app/stats");
  });

  it("gives an owner the Owner group, and only the links they may open", () => {
    const owner = appNav({
      ...NOBODY,
      isAdmin: true,
      isOwner: true,
      ownerDashboard: true,
      books: true,
    }).groups.find((g) => g.id === "owner");
    expect(owner?.links.map((l) => l.href)).toEqual([
      "/app/owner",
      "/app/books",
      "/app/admin/acting-admins",
    ]);
    // The operator sees the dashboard and books, never acting admins.
    const operator = appNav({ ...NOBODY, ownerDashboard: true, books: true });
    expect(
      operator.groups.find((g) => g.id === "owner")?.links.map((l) => l.href),
    ).toEqual(["/app/owner", "/app/books"]);
  });

  it("gives a ref with no team a Reffing tab and no player items", () => {
    const ref: NavInput = { ...NOBODY, isReferee: true, member: true };
    expect(appNav(ref).tabs.at(-1)).toEqual({
      href: "/app/referee",
      label: "Reffing",
      icon: "whistle",
    });
    expect(titles(ref)).not.toContain("Game day");
  });

  it("still offers subbing to someone signed in with no team yet", () => {
    expect(hrefs(NOBODY)).toContain("/app/subs");
    expect(hrefs(NOBODY)).not.toContain("/app/lost-and-found");
    expect(hrefs(NOBODY)).not.toContain("/app/photos");
  });

  it("points a free agent at their season and leaves out switched-off features", () => {
    const nav = appNav({
      ...NOBODY,
      seasons: [fall({ teamName: null, role: null })],
      pickem: false,
    });
    expect(nav.tabs.map((t) => t.label)).toEqual(["Home", "Schedule"]);
    expect(hrefs({ ...NOBODY, pickem: false })).not.toContain("/app/pickem");
    expect(nav.groups[0]?.links[0]).toEqual({
      href: "/app/seasons/fall-2026",
      label: "Fall 2026: your spot",
    });
  });

  it("shows only the current team, as Your team, for a player on two seasons", () => {
    const nav = appNav({
      ...player,
      seasons: [
        fall(),
        fall({ seasonSlug: "spring-2027", seasonName: "Spring 2027" }),
      ],
    });
    const mySeason = nav.groups.find((g) => g.id === "my-season");
    expect(mySeason?.links[0]).toEqual({
      href: "/app/seasons/fall-2026/team",
      label: "Your team",
    });
    expect(
      hrefs({
        ...player,
        seasons: [fall(), fall({ seasonSlug: "spring-2027" })],
      }),
    ).not.toContain("/app/seasons/spring-2027/team");
  });

  it("puts a ref's stats under Account instead of a one-link My season", () => {
    const ref: NavInput = { ...NOBODY, isReferee: true, plays: true };
    expect(titles(ref)).not.toContain("My season");
    expect(
      appNav(ref)
        .groups.find((g) => g.id === "account")
        ?.links.map((l) => l.label),
    ).toEqual(["Your profile", "Your stats"]);
  });

  it("offers the person's other leagues under Account", () => {
    const account = appNav({
      ...player,
      otherLeagues: [{ slug: "flag-football", name: "Sunday Flag" }],
    }).groups.find((g) => g.id === "account");
    expect(account?.links.at(-1)).toEqual({
      href: "/app/league/flag-football?next=%2Fapp",
      label: "Switch to Sunday Flag",
      document: true,
    });
  });

  it("keeps public links in the league on show", () => {
    const nav = appNav({ ...player, leagueBase: "/l/football" });
    expect(nav.tabs[1]?.href).toBe("/l/football/seasons/fall-2026/schedule");
    expect(hrefs({ ...player, leagueBase: "/l/football" })).toContain(
      "/l/football/seasons/fall-2026/standings",
    );
  });
});
