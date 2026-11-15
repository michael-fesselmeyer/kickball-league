import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

const WAYS_ON = [
  { href: "/", label: "Home page" },
  { href: "/events", label: "Events" },
  { href: "/faq", label: "Questions, answered" },
  { href: "/app", label: "Your games and team" },
] as const;

/**
 * The page for any address that doesn't exist, and for pages a visitor may
 * not see. It never says which, so it can't hint that a private page exists.
 * Static: no data, no cookies.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
      <p className="sticker self-start">404</p>
      <h1 className="text-h1">We can&apos;t find that page</h1>
      <p>
        The link may be old, or the page may have moved. Check the address, or
        pick up from one of these:
      </p>
      <ul className="flex flex-col">
        {WAYS_ON.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center font-bold underline underline-offset-4"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
