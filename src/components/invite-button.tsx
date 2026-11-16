import { inviteSite } from "@/domain/events/audience";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

/**
 * An event's external invite (Partiful or any https page) as a button that
 * names where it goes. Opens in a new tab and sends no referrer.
 */
export function InviteButton({
  url,
  primary = false,
  locale = DEFAULT_LOCALE,
}: {
  url: string;
  primary?: boolean;
  /** The page's language (ADR 0094); English unless given. */
  locale?: Locale;
}) {
  const words = messagesFor(locale).event;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`btn ${primary ? "btn-primary" : "btn-secondary"}`}
    >
      {fill(words.rsvpOn, { site: inviteSite(url) })}
      <span className="sr-only">{words.newTab}</span>
    </a>
  );
}
