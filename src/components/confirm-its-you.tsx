import { SESSION_FRESH_AGE_SECONDS } from "@/lib/auth/config";
import { emailConfirmLink } from "@/lib/auth/confirm-actions";
import { PasskeyConfirm } from "./passkey-confirm";

const FRESH_MINUTES = SESSION_FRESH_AGE_SECONDS / 60;

/**
 * The prompt before a sensitive action when the session is older than the
 * fresh age (docs/architecture.md, section 4): confirm with a passkey in one
 * tap, or with a new email link that brings the person back to this page.
 * Either is a new sign-in, so the page then lets them continue.
 */
export function ConfirmItsYou({
  what,
  email,
  next,
  confirm,
  hasPasskey,
}: {
  /** What the confirmation unlocks, finishing "To …, first confirm it's you." */
  what: string;
  email: string;
  /** This page's path, where the email link returns. */
  next: string;
  /** The page's `?confirm=` value after the email form posts. */
  confirm: string | string[] | undefined;
  hasPasskey: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <p>
        To {what}, first confirm it&apos;s you. You then have {FRESH_MINUTES}{" "}
        minutes.
      </p>
      {hasPasskey && <PasskeyConfirm />}
      {confirm === "sent" ? (
        <p role="status" className="rounded-lg border border-success p-3">
          Link sent to {email}. Open it on this device to continue.
        </p>
      ) : (
        <form action={emailConfirmLink} className="flex flex-col gap-2">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="btn self-start btn-secondary">
            Email me a sign-in link
          </button>
          <p className="text-small text-text-muted">
            We&apos;ll send it to <strong>{email}</strong>, and it brings you
            back here.
          </p>
        </form>
      )}
      {confirm === "error" && (
        <p role="alert" className="text-small text-danger">
          We couldn&apos;t send the link just now. Try again in a minute.
        </p>
      )}
    </div>
  );
}
