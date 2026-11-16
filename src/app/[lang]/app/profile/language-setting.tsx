import { SubmitButton } from "@/components/submit-button";
import { fill } from "@/i18n/catalog";
import {
  LANG_ATTRIBUTES,
  LOCALE_NAMES,
  LOCALES,
  type Locale,
} from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { saveLanguageAction } from "./actions";

/**
 * The language a person reads the league in (ADR 0094). Its words are in
 * the language chosen, so someone who picked Spanish by mistake can still
 * find their way back. A plain form: it works before any JavaScript loads.
 */
export function LanguageSetting({
  language,
  saved,
}: {
  language: Locale;
  saved: boolean;
}) {
  const words = messagesFor(language).profile.language;
  return (
    <section
      id="language"
      aria-labelledby="language-heading"
      lang={LANG_ATTRIBUTES[language]}
      className="flex flex-col gap-3"
    >
      <h2 id="language-heading" className="text-h2">
        {words.label}
      </h2>
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {fill(words.saved, { language: LOCALE_NAMES[language] })}
        </p>
      )}
      <form action={saveLanguageAction} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">{words.label}</legend>
          {LOCALES.map((locale) => (
            <label
              key={locale}
              lang={LANG_ATTRIBUTES[locale]}
              className="flex min-h-11 items-center gap-2"
            >
              <input
                type="radio"
                name="language"
                value={locale}
                defaultChecked={locale === language}
                className="size-5"
              />
              {LOCALE_NAMES[locale]}
            </label>
          ))}
        </fieldset>
        <p className="text-small text-text-muted">{words.hint}</p>
        <SubmitButton className="btn self-start btn-secondary">
          {messagesFor(language).profile.language.save}
        </SubmitButton>
      </form>
    </section>
  );
}
