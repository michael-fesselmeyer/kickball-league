import { LANG_ATTRIBUTES, LOCALE_NAMES, type Locale } from "@/i18n/locales";
import { offeredLocales } from "@/i18n/pages";
import { languageSwitchScript } from "@/lib/language-switch-script";

/**
 * The footer's language links (ADR 0094), rendered on the server with no
 * client bundle. Each goes through `/language/<code>`, which sends the
 * visitor on to the page they were on, in that language where it is
 * translated (src/i18n/routing.ts, languageSwitchTarget). A few lines of
 * inline script add that page's path to the link as it is followed
 * (src/lib/language-switch-script.ts). Nothing until a second language has
 * a translated page.
 */
export function LanguageSwitcher({
  current,
  label,
}: {
  current: Locale;
  label: string;
}) {
  const locales = offeredLocales();
  if (locales.length < 2) return null;
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {locales.map((locale) => (
          <li key={locale}>
            {/* A plain link: the target is a redirect, not a page to prefetch. */}
            <a
              href={`/language/${locale}`}
              data-language-switch={`/language/${locale}`}
              hrefLang={LANG_ATTRIBUTES[locale]}
              lang={LANG_ATTRIBUTES[locale]}
              rel="nofollow"
              aria-current={locale === current ? "true" : undefined}
              className="inline-flex min-h-11 items-center font-bold text-text underline-offset-4 hover:underline aria-[current=true]:underline"
            >
              {LOCALE_NAMES[locale]}
            </a>
          </li>
        ))}
      </ul>
      {/* Names the current page on click, with no script file to download. */}
      <script dangerouslySetInnerHTML={{ __html: languageSwitchScript }} />
    </nav>
  );
}
