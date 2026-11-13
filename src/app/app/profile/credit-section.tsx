import { ShareButtons } from "@/components/share";
import { type CreditReason, describeCredit } from "@/domain/money/credit";
import { formatCents } from "@/domain/registration/pricing";
import { makeReferralLinkAction } from "./referral-actions";

type Entry = {
  id: string;
  deltaCents: number;
  reason: CreditReason;
  note: string | null;
  createdAt: Date;
  seasonName: string | null;
};

/**
 * League credit and referrals on the account page (roadmap item 13): the
 * balance that comes off the next checkout, where it came from, and the
 * link that earns more.
 */
export function CreditSection({
  balanceCents,
  history,
  timeZone,
  referralLink,
  referralCents,
  referrals,
}: {
  balanceCents: number;
  history: Entry[];
  timeZone: string;
  referralLink: string | null;
  referralCents: number;
  referrals: { pending: number; credited: number };
}) {
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  return (
    <>
      <section
        id="credit"
        aria-labelledby="credit-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="credit-heading" className="text-h2">
          League credit
        </h2>
        <p>
          <strong className="text-h3">{formatCents(balanceCents)}</strong>{" "}
          <span className="text-text-muted">
            {balanceCents > 0
              ? "comes off your next fee when you pay."
              : "Rain-out rebates and referral rewards land here."}
          </span>
        </p>
        {history.length > 0 && (
          <ul className="flex flex-col">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex justify-between gap-3 border-b border-border py-2"
              >
                <span className="flex flex-col">
                  <span>{describeCredit(h.reason)}</span>
                  <span className="text-small text-text-muted">
                    {day.format(h.createdAt)}
                    {h.note ? ` · ${h.note}` : ""}
                    {h.seasonName ? ` · ${h.seasonName}` : ""}
                  </span>
                </span>
                <span
                  className={
                    h.deltaCents > 0 ? "text-success" : "text-text-muted"
                  }
                >
                  {h.deltaCents > 0 ? "+" : "−"}
                  {formatCents(Math.abs(h.deltaCents))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        id="invite"
        aria-labelledby="invite-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="invite-heading" className="text-h2">
          Bring a friend, get {formatCents(referralCents)}
        </h2>
        <p>
          Share your link. When someone new signs up through it and pays for a
          season, you get {formatCents(referralCents)} of league credit.
          {referrals.credited + referrals.pending > 0 &&
            ` So far: ${referrals.credited} paid, ${referrals.pending} still to pay.`}
        </p>
        {referralLink ? (
          <>
            <p className="rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-small break-all">
              {referralLink}
            </p>
            <ShareButtons
              title="Play kickball with us"
              text={`Come play kickball with us this season! Sign up here: ${referralLink}`}
            />
          </>
        ) : (
          <form action={makeReferralLinkAction}>
            <button type="submit" className="btn btn-secondary">
              Get my invite link
            </button>
          </form>
        )}
      </section>
    </>
  );
}
