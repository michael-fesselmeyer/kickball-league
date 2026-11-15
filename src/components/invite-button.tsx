import { inviteSite } from "@/domain/events/audience";

/**
 * An event's external invite (Partiful or any https page) as a button that
 * names where it goes. Opens in a new tab and sends no referrer.
 */
export function InviteButton({
  url,
  primary = false,
}: {
  url: string;
  primary?: boolean;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`btn ${primary ? "btn-primary" : "btn-secondary"}`}
    >
      RSVP on {inviteSite(url)}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
