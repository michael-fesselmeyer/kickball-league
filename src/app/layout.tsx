import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import Link from "next/link";
import { DemoBanner } from "@/components/demo-banner";
import { Kickball } from "@/components/kickball";
import { ThemeSwitch } from "@/components/theme-switch";
import { env } from "@/env";
import { registerWorkerScript } from "@/lib/pwa/install";
import { appIconPath } from "@/lib/pwa/icons";
import { THEME_COLORS } from "@/lib/pwa/theme-colors";
import { isIndexable, SITE, siteOrigin } from "@/lib/site";
import { applySavedThemeScript } from "@/lib/theme";
import "./globals.css";
import "./motion.css";

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

export const metadata: Metadata = {
  title: { default: "Kickball League", template: "%s · Kickball League" },
  description: SITE.description,
  // Relative canonical and share URLs resolve against this deployment.
  metadataBase: new URL(siteOrigin(env.BETTER_AUTH_URL)),
  openGraph: { siteName: SITE.name, type: "website", locale: "en_US" },
  // Previews and local builds stay out of search (docs/seo-plan.md).
  robots: isIndexable(process.env) ? undefined : { index: false },
  // The installable app (docs/architecture.md, section 14).
  icons: { apple: appIconPath("apple-touch-icon.png") },
  appleWebApp: { capable: true, title: "Kickball", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light.theme },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark.theme },
  ],
};

const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/events", label: "Events" },
  { href: "/faq", label: "FAQ" },
  { href: "/parks/mccarren-park", label: "McCarren Park" },
  { href: "/sponsors", label: "Sponsors" },
  { href: "/sign-in", label: "Sign in" },
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by the script below, so React must not
    // warn that the server-rendered attribute differs.
    <html
      lang="en"
      className={`${inter.variable} ${bricolage.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applySavedThemeScript }} />
        {process.env.NODE_ENV === "production" && (
          // The service worker runs in production builds only, so it never
          // serves a stale file during development.
          <script dangerouslySetInnerHTML={{ __html: registerWorkerScript }} />
        )}
      </head>
      <body className="flex min-h-full flex-col">
        <DemoBanner />
        <header className="border-b-2 border-text bg-surface">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2 md:px-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-h3 font-extrabold text-text"
            >
              <Kickball className="size-8 -rotate-12" />
              Kickball League
            </Link>
            <ThemeSwitch />
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t-2 border-text bg-surface">
          <nav
            aria-label="Site"
            className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 md:px-6"
          >
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center font-bold text-text underline-offset-4 hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </footer>
      </body>
    </html>
  );
}
