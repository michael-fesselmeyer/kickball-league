import type { Metadata } from "next";
import { Archivo, Inter } from "next/font/google";
import Link from "next/link";
import { ThemeSwitch } from "@/components/theme-switch";
import { applySavedThemeScript } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Width axis: wide athletic headings now, condensed scoreboard numbers later.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Kickball League", template: "%s · Kickball League" },
  description:
    "Sign up, pay, see the schedule and scores for a recreational adult kickball league.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by the script below, so React must not
    // warn that the server-rendered attribute differs.
    <html
      lang="en"
      className={`${inter.variable} ${archivo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applySavedThemeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2 md:px-6">
            <Link
              href="/"
              className="font-display text-h3 font-extrabold text-text"
            >
              Kickball League
            </Link>
            <ThemeSwitch />
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
