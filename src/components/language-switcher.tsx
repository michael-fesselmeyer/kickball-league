"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALE_NAMES, type Locale } from "@/i18n/locales";
import { localesOf } from "@/i18n/pages";
import { publicPathOf, switchLanguagePath } from "@/i18n/routing";

/**
 * The footer's language links (ADR 0094): the page you're on, in each
 * language it is translated into; nothing for a page in English only. On a
 * signed-in page, the language comes from the profile, so the links go
 * there instead.
 */
export function LanguageSwitcher({
  current,
  label,
  profileHref = "/app/profile#language",
}: {
  current: Locale;
  label: string;
  profileHref?: string;
}) {
  const path = publicPathOf(usePathname() ?? "/");
  if (path === "/app" || path.startsWith("/app/"))
    return (
      <Link
        href={profileHref}
        className="inline-flex min-h-11 items-center font-bold text-text underline-offset-4 hover:underline"
      >
        {label}: {LOCALE_NAMES[current]}
      </Link>
    );
  const locales = localesOf(path);
  if (locales.length < 2) return null;
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {locales.map((locale) => (
          <li key={locale}>
            <Link
              href={switchLanguagePath(path, locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? "true" : undefined}
              className="inline-flex min-h-11 items-center font-bold text-text underline-offset-4 hover:underline aria-[current=true]:underline"
            >
              {LOCALE_NAMES[locale]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
