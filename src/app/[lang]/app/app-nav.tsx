import Link from "next/link";
import { can } from "@/domain/authz/permissions";
import { type LeagueId, parseId, type UserId } from "@/domain/ids";
import { leagueBase } from "@/domain/league/paths";
import { appNav, type NavIcon } from "@/domain/nav/app-nav";
import { currentSubject } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { myLeagues, mySeasons } from "@/lib/nav/my-seasons";
import { featureEnabled } from "@/lib/platform/site";
import { signOut } from "./actions";
import { CloseMenuOnLink, TabLink } from "./nav-client";
import { SignOutForm } from "./offline-sync";

const MENU_ID = "app-menu";

const MENU_LINK =
  "flex min-h-11 items-center border-b border-border font-bold hover:underline";

/** A tab: icon over its word on a phone, side by side on a wider screen. */
const TAB =
  "group flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-micro font-bold text-text-muted hover:text-text aria-[current=page]:text-text md:min-h-11 md:w-auto md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-small md:aria-[current=page]:bg-surface-2";

/**
 * The signed-in app's navigation: a tab bar along the bottom of a phone, a
 * bar under the header on a wider screen, and a grouped menu. Every link is
 * one the person may open (docs/information-architecture.md, section 2).
 */
export async function AppNav() {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (!userId) return <NavPlaceholder />;
  const [seasons, league, pickem, awards, leagues] = await Promise.all([
    mySeasons(userId, parseId<LeagueId>(subject.leagueId)),
    activeLeague(),
    featureEnabled("pickem"),
    featureEnabled("awards"),
    myLeagues(userId),
  ]);
  const { tabs, groups } = appNav({
    seasons,
    plays: subject.roster.length > 0,
    isReferee: subject.isReferee,
    isAdmin: can(subject, "season.manage"),
    isOwner: can(subject, "admins.manage"),
    ownerDashboard: can(subject, "dashboard.view"),
    books: can(subject, "books.manage"),
    sponsor: subject.sponsorIds.length > 0,
    photos: can(subject, "photos.upload"),
    member: can(subject, "lost_found.use"),
    pickem,
    awards,
    leagueBase: league ? leagueBase(league) : "",
    otherLeagues: leagues.filter((l) => l.id !== league?.id),
  });

  return (
    <>
      <nav aria-label="App" className="app-nav print:hidden">
        <ul className="mx-auto flex w-full max-w-5xl md:gap-1 md:px-6 md:py-1">
          {tabs.map((tab) => (
            <li key={tab.href} className="flex flex-1 md:flex-none">
              <TabLink
                href={tab.href}
                exact={tab.icon === "home"}
                className={TAB}
              >
                <Icon name={tab.icon} />
                {tab.label}
              </TabLink>
            </li>
          ))}
          <li className="flex flex-1 md:ml-auto md:flex-none">
            <button type="button" popoverTarget={MENU_ID} className={TAB}>
              <Icon name="menu" />
              Menu
            </button>
          </li>
        </ul>
      </nav>
      <div
        id={MENU_ID}
        popover="auto"
        role="dialog"
        aria-labelledby="app-menu-title"
        className="app-menu print:hidden"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="app-menu-title" className="text-h3">
            Menu
          </h2>
          <button
            type="button"
            popoverTarget={MENU_ID}
            popoverTargetAction="hide"
            className="btn min-h-11 px-4 btn-secondary"
          >
            Close
          </button>
        </div>
        <nav aria-label="Menu" className="mt-2 flex flex-col gap-5">
          {groups.map((group) => (
            <section
              key={group.id}
              aria-labelledby={`menu-${group.id}`}
              className="flex flex-col"
            >
              <h3
                id={`menu-${group.id}`}
                className="text-micro font-bold tracking-widest text-text-muted uppercase"
              >
                {group.title}
              </h3>
              <ul className="flex flex-col">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.document ? (
                      <a href={link.href} className={MENU_LINK}>
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        prefetch={false}
                        className={MENU_LINK}
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="mt-5">
          <SignOutForm action={signOut} />
        </div>
        <CloseMenuOnLink menuId={MENU_ID} />
      </div>
    </>
  );
}

/**
 * Holds the bar's place while it loads, so nothing moves when it arrives.
 * Signed-out pages under /app (an invite link) keep it empty.
 */
export function NavPlaceholder() {
  return <div aria-hidden="true" className="app-nav print:hidden" />;
}

const PATHS: Record<NavIcon | "menu", string> = {
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  schedule: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  team: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.8.8 3 2.6 3 4.5",
  admin: "M12 3 4 6v6c0 4.4 3.4 8 8 9 4.6-1 8-4.6 8-9V6z",
  whistle: "M8 8h8a5 5 0 1 1-5 5H4V9a1 1 0 0 1 1-1h3V5",
  menu: "M4 7h16M4 12h16M4 17h16",
};

function Icon({ name }: { name: NavIcon | "menu" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-7 w-12 rounded-full px-3 py-0.5 group-aria-[current=page]:bg-surface-2 md:size-5 md:p-0 md:group-aria-[current=page]:bg-transparent"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
