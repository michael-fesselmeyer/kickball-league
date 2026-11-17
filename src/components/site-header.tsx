import Image from "next/image";
import Link from "next/link";
import { Kickball } from "@/components/kickball";
import { ThemeSwitch, type ThemeLabels } from "@/components/theme-switch";
import type { SiteLogo } from "@/lib/site";

export const SITE_MENU_ID = "site-menu";

/** The header's words, in the page's language (ADR 0094). */
export type SiteHeaderWords = {
  brand: string;
  nav: string;
  schedule: string;
  standings: string;
  events: string;
  faq: string;
  join: string;
  signIn: string;
  menu: string;
  close: string;
  more: string;
  about: string;
  history: string;
  help: string;
  contact: string;
  theme: ThemeLabels;
};

const NAV_LINK =
  "inline-flex min-h-11 items-center rounded-full px-3 font-bold text-text underline-offset-4 hover:underline";
const SHEET_LINK =
  "flex min-h-11 items-center border-b border-border font-bold hover:underline";

/**
 * The public site's header (docs/information-architecture.md, Navigation):
 * the league's name, then on a wide screen the top links and a sign-in
 * button; on a phone a Join button and a menu sheet for the rest. The sheet
 * is a native popover, like the app's menu, so no script opens it.
 *
 * Part of every static page, so it reads nothing about the visitor: the
 * sign-in link's words work whether or not they're signed in, and
 * `/sign-in` itself offers the way into the app to someone who is. Inside
 * the app (`body:has(.app-nav)`, globals.css) the links give way to the
 * app's own tabs and menu.
 *
 * A deployment that configures the league's logo (src/lib/site.ts) shows it
 * in place of the kickball mark, and one with a short name shows that on a
 * phone, where the full name would push the buttons onto a second line.
 */
export function SiteHeader({
  words,
  href,
  logo = null,
  shortBrand = null,
}: {
  words: SiteHeaderWords;
  /** The league's logo, already sized small at build time (scripts/demo.mjs). */
  logo?: SiteLogo | null;
  /** The league's short name, shown instead of the full one on a phone. */
  shortBrand?: string | null;
  /** Puts a path in the page's language where it is translated. */
  href: (path: string) => string;
}) {
  const top = [
    // A short hop to the season being played (seasons/current/[view]).
    { path: "/seasons/current/schedule", label: words.schedule, hop: true },
    { path: "/seasons/current/standings", label: words.standings, hop: true },
    { path: "/events", label: words.events, hop: false },
    { path: "/faq", label: words.faq, hop: false },
  ];
  const more = [
    { path: "/about", label: words.about },
    { path: "/history", label: words.history },
    { path: "/help", label: words.help },
    { path: "/contact", label: words.contact },
  ];
  return (
    <header className="bg-surface ringer-stripes print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:px-6">
        <Link
          href={href("/")}
          className="mr-auto flex min-h-11 items-center gap-2 font-display text-body-lg text-accent sm:text-h3"
        >
          {logo ? (
            <Image
              src={logo.src}
              width={logo.width}
              height={logo.height}
              // Resized when the demo is built; no optimizer round trip.
              unoptimized
              alt=""
              className="h-9 w-auto max-w-24 object-contain sm:h-10"
            />
          ) : (
            <Kickball className="size-7 -rotate-12 sm:size-8" />
          )}
          {shortBrand ? (
            <>
              <span className="sm:hidden">{shortBrand}</span>
              {/* Beside the laptop nav, a long name takes two balanced
                  lines rather than pushing the buttons onto a second row. */}
              <span className="hidden sm:inline lg:inline-block lg:max-w-40 lg:text-[1.25rem] lg:leading-none lg:text-balance">
                {words.brand}
              </span>
            </>
          ) : (
            words.brand
          )}
        </Link>
        <nav aria-label={words.nav} className="site-nav hidden lg:block">
          <ul className="flex items-center">
            {top.map((link) => (
              <li key={link.path}>
                <Link
                  href={href(link.path)}
                  prefetch={link.hop ? false : null}
                  className={NAV_LINK}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="site-nav ml-auto flex items-center gap-2">
          <Link href={href("/seasons")} className="btn btn-primary">
            {words.join}
          </Link>
          <Link
            href={href("/sign-in")}
            prefetch={false}
            className="btn hidden btn-secondary lg:inline-flex"
          >
            {words.signIn}
          </Link>
          <button
            type="button"
            popoverTarget={SITE_MENU_ID}
            aria-label={words.menu}
            className="btn size-11 px-0 btn-secondary lg:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              width={20}
              height={20}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
        <span className="site-theme flex">
          <ThemeSwitch labels={words.theme} />
        </span>
      </div>
      <div
        id={SITE_MENU_ID}
        popover="auto"
        role="dialog"
        aria-labelledby="site-menu-title"
        className="app-menu site-menu"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="site-menu-title" className="text-h3">
            {words.menu}
          </h2>
          <span className="flex items-center gap-3">
            <ThemeSwitch labels={words.theme} />
            <button
              type="button"
              popoverTarget={SITE_MENU_ID}
              popoverTargetAction="hide"
              className="btn min-h-11 px-4 btn-secondary"
            >
              {words.close}
            </button>
          </span>
        </div>
        <nav aria-label={words.menu} className="mt-2 flex flex-col gap-5">
          <ul className="flex flex-col">
            {top.map((link) => (
              <li key={link.path}>
                <Link
                  href={href(link.path)}
                  prefetch={false}
                  className={SHEET_LINK}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <section aria-labelledby="site-menu-more" className="flex flex-col">
            <h3
              id="site-menu-more"
              className="text-micro font-bold tracking-widest text-text-muted uppercase"
            >
              {words.more}
            </h3>
            <ul className="flex flex-col">
              {more.map((link) => (
                <li key={link.path}>
                  <Link
                    href={href(link.path)}
                    prefetch={false}
                    className={SHEET_LINK}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </nav>
        <Link
          href={href("/sign-in")}
          prefetch={false}
          className="mt-5 btn w-full btn-secondary"
        >
          {words.signIn}
        </Link>
      </div>
    </header>
  );
}
