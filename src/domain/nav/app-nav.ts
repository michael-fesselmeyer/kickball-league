/**
 * The signed-in app's navigation (docs/information-architecture.md): a few
 * tabs and a grouped menu, built from what the person may open. Roles add
 * groups instead of switching views, so an admin who also refs sees both,
 * and nobody is shown a link to a page that would turn them away.
 */

import type { RosterRole } from "@/domain/authz/permissions";

/** One of this person's current registrations in the league on show. */
export type NavSeason = {
  seasonSlug: string;
  seasonName: string;
  /** Null for a free agent who has no team yet. */
  teamName: string | null;
  role: RosterRole | null;
};

export type NavInput = {
  /** Current registrations in the league on show, soonest season first. */
  seasons: readonly NavSeason[];
  /** On a roster in this league (a team or a sub list). */
  plays: boolean;
  isReferee: boolean;
  /** Opens League admin: an admin or owner of this league. */
  isAdmin: boolean;
  /** The league's owner (acting admins are theirs to hand out). */
  isOwner: boolean;
  /** Opens the owner dashboard (owners and the operator). */
  ownerDashboard: boolean;
  /** Keeps the books (owners and the operator). */
  books: boolean;
  /** Manages a sponsor's page. */
  sponsor: boolean;
  /** May share a photo (on a team, or an admin). */
  photos: boolean;
  /** Belongs to the league (lost and found is for its members). */
  member: boolean;
  /** Features the league has on. */
  pickem: boolean;
  awards: boolean;
  /** Public pages of this league start here: "" or "/l/<slug>". */
  leagueBase: string;
  /** This person's other leagues, to switch to (ADR 0048). */
  otherLeagues?: readonly { slug: string; name: string }[];
};

export type NavIcon = "home" | "schedule" | "team" | "admin" | "whistle";
export type NavTab = { href: string; label: string; icon: NavIcon };
/**
 * A menu link. `document` links go to a route handler (the league switch),
 * so they load as a whole page instead of through the client router.
 */
export type NavLink = { href: string; label: string; document?: boolean };
export type NavGroup = { id: string; title: string; links: NavLink[] };

export type AppNav = { tabs: NavTab[]; groups: NavGroup[] };

const isCaptain = (role: RosterRole | null) =>
  role === "captain" || role === "co_captain";

/**
 * The season the Team and Schedule tabs open: the first of the current
 * seasons (they come soonest first), so the one being played wins over one
 * still taking sign-ups.
 */
function primaryTeam(seasons: readonly NavSeason[]): NavSeason | null {
  return seasons.find((s) => s.teamName !== null) ?? null;
}

export function appNav(input: NavInput): AppNav {
  const team = primaryTeam(input.seasons);
  const anySeason = team ?? input.seasons.at(0) ?? null;
  const pub = (path: string) => `${input.leagueBase}${path}`;
  // Player items are for people who play, or might: everyone signed in
  // except league staff with no team of their own.
  const playing =
    input.plays ||
    input.seasons.length > 0 ||
    (!input.isAdmin && !input.isReferee && !input.sponsor);

  const tabs: NavTab[] = [{ href: "/app", label: "Home", icon: "home" }];
  tabs.push({
    href: anySeason
      ? pub(`/seasons/${anySeason.seasonSlug}/schedule`)
      : pub("/seasons"),
    label: "Schedule",
    icon: "schedule",
  });
  if (team)
    tabs.push({
      href: `/app/seasons/${team.seasonSlug}/team`,
      label: "Team",
      icon: "team",
    });
  else if (input.isAdmin)
    tabs.push({ href: "/app/admin", label: "Admin", icon: "admin" });
  else if (input.isReferee)
    tabs.push({ href: "/app/referee", label: "Reffing", icon: "whistle" });

  const groups: NavGroup[] = [];
  const add = (id: string, title: string, links: (NavLink | false)[]) => {
    const kept = links.filter((l): l is NavLink => l !== false);
    if (kept.length > 0) groups.push({ id, title, links: kept });
  };

  // "Your stats" sits in My season, or under Account when it would be My
  // season's only link (a ref on no current team), so no group is a lone
  // link that also sits elsewhere.
  let statsInAccount = false;
  if (playing) {
    const seasonLinks = [
      // The current team only; Home lists every season's team.
      team !== null && {
        href: `/app/seasons/${team.seasonSlug}/team`,
        label: "Your team",
      },
      ...input.seasons
        .filter((s) => !s.teamName)
        .map((s) => ({
          href: `/app/seasons/${s.seasonSlug}`,
          label: `${s.seasonName}: your spot`,
        })),
      anySeason !== null && {
        href: pub(`/seasons/${anySeason.seasonSlug}/schedule`),
        label: "Schedule",
      },
      anySeason !== null && {
        href: pub(`/seasons/${anySeason.seasonSlug}/standings`),
        label: "Standings",
      },
    ].filter((l): l is NavLink => l !== false);
    if (seasonLinks.length > 0)
      add("my-season", "My season", [
        ...seasonLinks,
        input.plays && { href: "/app/stats", label: "Your stats" },
      ]);
    else statsInAccount = input.plays;
    add("game-day", "Game day", [
      input.pickem && { href: "/app/pickem", label: "Pick'em" },
      input.plays &&
        input.awards && { href: "/app/vote", label: "Vote for awards" },
      { href: "/app/subs", label: "Sub for a team" },
    ]);
  }

  // A captain's tools for each team they captain (or co-captain).
  const captained = input.seasons.filter(
    (s) => s.teamName && isCaptain(s.role),
  );
  for (const s of captained) {
    const base = `/app/seasons/${s.seasonSlug}/team`;
    add(
      captained.length > 1 ? `captain-${s.seasonSlug}` : "captain",
      captained.length > 1 ? `Captain: ${s.teamName}` : "Captain",
      [
        { href: base, label: "Roster and payments" },
        { href: `${base}/announcements`, label: "Message your team" },
        { href: `${base}/attendance`, label: "Attendance" },
        { href: `${base}/subs`, label: "Find subs" },
        { href: `${base}/requests`, label: "Scheduling requests" },
      ],
    );
  }

  if (input.isReferee)
    add("referee", "Referee", [
      { href: "/app/referee", label: "Your games, availability and pay" },
    ]);

  if (input.isAdmin)
    add("admin", "League admin", [
      { href: "/app/admin", label: "Admin dashboard" },
      { href: "/app/admin/today", label: "Game day screen" },
      { href: "/app/admin/seasons", label: "Seasons" },
      { href: "/app/admin/events", label: "Manage events" },
      { href: "/app/admin/volunteer", label: "Volunteer shifts" },
      { href: "/app/admin/incidents", label: "Incidents" },
    ]);

  if (input.ownerDashboard || input.books || input.isOwner)
    add("owner", "Owner", [
      input.ownerDashboard && { href: "/app/owner", label: "Owner dashboard" },
      input.books && { href: "/app/books", label: "Books" },
      input.isOwner && {
        href: "/app/admin/acting-admins",
        label: "Acting admins",
      },
    ]);

  add("league-life", "League life", [
    { href: "/app/events", label: "Events" },
    { href: "/app/volunteer", label: "Volunteer" },
    { href: "/app/shop", label: "League shop" },
    input.photos && { href: "/app/photos", label: "Share a photo" },
  ]);

  add("help", "Help", [
    { href: "/help", label: "Help center" },
    { href: "/app/rules", label: "League rules" },
    { href: "/app/concerns", label: "Raise a concern" },
    input.member && { href: "/app/lost-and-found", label: "Lost and found" },
  ]);

  add("account", "Account", [
    { href: "/app/profile", label: "Your profile" },
    statsInAccount && { href: "/app/stats", label: "Your stats" },
    input.sponsor && { href: "/app/sponsor", label: "Your sponsor page" },
    ...(input.otherLeagues ?? []).map((l) => ({
      href: `/app/league/${l.slug}?next=${encodeURIComponent("/app")}`,
      label: `Switch to ${l.name}`,
      document: true,
    })),
  ]);

  return { tabs, groups };
}
