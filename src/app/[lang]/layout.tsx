import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import Link from "next/link";
import { DemoBanner } from "@/components/demo-banner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Kickball } from "@/components/kickball";
import { ThemeSwitch } from "@/components/theme-switch";
import { env } from "@/env";
import { nativeShellScript } from "@/lib/mobile/native-shell";
import { LOCALES, localizedPath } from "@/i18n/locales";
import { isTranslated } from "@/i18n/pages";
import { localeOf, messagesFor } from "@/i18n/messages";
import { registerWorkerScript } from "@/lib/pwa/install";
import { appIconPath } from "@/lib/pwa/icons";
import { THEME_COLORS } from "@/lib/pwa/theme-colors";
import { isIndexable, SITE, siteOrigin } from "@/lib/site";
import { applySavedThemeScript } from "@/lib/theme";
import { themeSwitchScript } from "@/lib/theme-switch-script";
import "../globals.css";
import "../motion.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Playful display face (ADR 0002). Weight axis only: the width axis (for the
// condensed scoreboard face) is added with the scoreboard, so pages don't pay
// for it before it is used. Fonts are budgeted at 120 kB in total.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Every page lives under `[lang]` (ADR 0094), so the root layout knows the
 * page's language from the path and stays static. The proxy only ever
 * serves a known language's tree; any other first segment is a page path
 * and lands on the not-found page.
 */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

const OPEN_GRAPH_LOCALES = { en: "en_US", es: "es_US" } as const;

export async function generateMetadata({
  params,
}: LayoutProps<"/[lang]">): Promise<Metadata> {
  const locale = localeOf((await params).lang);
  const brand = messagesFor(locale).shell.brand;
  return {
    ...METADATA,
    title: { default: brand, template: `%s · ${brand}` },
    openGraph: {
      siteName: SITE.name,
      type: "website",
      locale: OPEN_GRAPH_LOCALES[locale],
    },
  };
}

const METADATA: Metadata = {
  description: SITE.description,
  // Relative canonical and share URLs resolve against this deployment.
  metadataBase: new URL(siteOrigin(env.BETTER_AUTH_URL)),
  // Previews and local builds stay out of search (docs/seo-plan.md).
  robots: isIndexable(process.env) ? undefined : { index: false },
  // The installable app (docs/architecture.md, section 14).
  icons: { apple: appIconPath("apple-touch-icon.png") },
  appleWebApp: { capable: true, title: "Kickball", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Edge to edge, so the iOS and Android apps can draw under the status bar
  // and home indicator; the layout pads itself clear of them (pt-safe,
  // pb-safe, px-safe in globals.css).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light.theme },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark.theme },
  ],
};

const FOOTER_LINKS = [
  { href: "/seasons", key: "schedules" },
  { href: "/history", key: "history" },
  { href: "/about", key: "about" },
  { href: "/events", key: "events" },
  { href: "/faq", key: "faq" },
  { href: "/contact", key: "contact" },
  { href: "/friends", key: "friends" },
  { href: "/help", key: "help" },
  { href: "/parks/mccarren-park", key: "park" },
  { href: "/rules", key: "rules" },
  { href: "/sponsors", key: "sponsors" },
  { href: "/sign-in", key: "signIn" },
] as const;

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const locale = localeOf((await params).lang);
  const { shell } = messagesFor(locale);
  // A link stays in the page's language where its target is translated.
  const href = (path: string) =>
    isTranslated(locale, path) ? localizedPath(locale, path) : path;
  return (
    // data-theme is set before paint by the script below, so React must not
    // warn that the server-rendered attribute differs.
    <html
      lang={locale}
      className={`${inter.variable} ${bricolage.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applySavedThemeScript }} />
        {/* The theme button's behavior, with no script file to download. */}
        <script dangerouslySetInnerHTML={{ __html: themeSwitchScript }} />
        {/* Returns at once outside the iOS and Android apps (docs/mobile.md). */}
        <script dangerouslySetInnerHTML={{ __html: nativeShellScript }} />
        {process.env.NODE_ENV === "production" && (
          // The service worker runs in production builds only, so it never
          // serves a stale file during development.
          <script dangerouslySetInnerHTML={{ __html: registerWorkerScript }} />
        )}
      </head>
      <body className="flex min-h-full flex-col px-safe">
        {/* The first stop for a keyboard: past the banner and header. */}
        <a
          href="#content"
          className="fixed top-[calc(var(--safe-top)+0.5rem)] left-[calc(var(--safe-left)+0.5rem)] z-50 btn -translate-y-20 btn-primary focus:translate-y-0 print:hidden"
        >
          {shell.skipToContent}
        </a>
        {/* Paints the status bar's strip in the app with the header's color. */}
        <div className="bg-surface pt-safe print:pt-0">
          <DemoBanner />
          <header className="border-b-2 border-text bg-surface print:hidden">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2 md:px-6">
              <Link
                href={href("/")}
                className="flex items-center gap-2 font-display text-h3 font-extrabold text-text"
              >
                <Kickball className="size-8 -rotate-12" />
                {shell.brand}
              </Link>
              <ThemeSwitch labels={shell.theme} />
            </div>
          </header>
        </div>
        <div
          id="content"
          tabIndex={-1}
          className="flex flex-1 flex-col focus:outline-none"
        >
          {children}
        </div>
        <footer className="border-t-2 border-text bg-surface pb-safe print:hidden">
          <nav
            aria-label={shell.siteNav}
            className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 md:px-6"
          >
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={href(link.href)}
                className="inline-flex min-h-11 items-center font-bold text-text underline-offset-4 hover:underline"
              >
                {shell.footer[link.key]}
              </Link>
            ))}
          </nav>
          <div className="mx-auto w-full max-w-5xl px-4 pb-4 md:px-6">
            <LanguageSwitcher current={locale} label={shell.language.group} />
          </div>
        </footer>
      </body>
    </html>
  );
}
