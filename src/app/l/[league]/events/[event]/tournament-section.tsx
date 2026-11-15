import { BracketList, Champion } from "@/components/bracket";
import type { PublicTournament } from "@/db/queries/tournaments";
import { displayHost } from "@/domain/friends/friend-form";
import { moneyLine } from "@/domain/tournaments/tournament";
import { bracketViewOf } from "@/lib/tournaments/bracket-view";
import { GuestSignupForm } from "./guest-signup-form";

const SIGNUP_NOTES = {
  closed: "Guest sign-ups are closed.",
  full: "Every guest spot is taken.",
  over: "",
  cancelled: "",
} as const;

/**
 * What a tournament adds to its event page: the partner league, the charity
 * link, the guest teams, the sign-up form and the bracket. Server-rendered
 * from cached data; only the sign-up form is client code. The page shows
 * team names and nothing about their captains or players.
 */
export function TournamentSection({
  slug,
  t,
  timeZone,
}: {
  slug: string;
  t: PublicTournament;
  timeZone: string;
}) {
  const view = t.bracket ? bracketViewOf(t.bracket, timeZone) : null;
  return (
    <>
      {t.charity && (
        <section
          aria-labelledby="charity"
          className="flex flex-col items-start gap-3 rounded-card border-2 border-text bg-surface p-4 shadow-sticker"
        >
          <h2 id="charity" className="text-h3">
            Playing for {t.charity.name}
          </h2>
          {t.charity.goalCents !== null && (
            <p>
              Our goal: <strong>{moneyLine(t.charity.goalCents)}</strong>
            </p>
          )}
          <a
            href={t.charity.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Give at {displayHost(t.charity.url)}
            <span className="sr-only"> (another site, opens in a new tab)</span>
          </a>
          <p className="text-small text-text-muted">
            The link goes to the charity&apos;s own page. The league never
            takes or holds donations.
          </p>
        </section>
      )}

      {t.partner && (
        <p className="max-w-prose">
          Played with{" "}
          <a
            href={t.partner.url}
            rel="noopener"
            className="font-bold underline"
          >
            {t.partner.name}
            <span className="sr-only"> (another site)</span>
          </a>
          , another kickball league in the city.
        </p>
      )}

      <section aria-labelledby="guests" className="flex flex-col gap-3">
        <h2 id="guests" className="text-h2">
          Guest teams
        </h2>
        {t.guestTeams.length === 0 ? (
          <p className="text-text-muted">No guest teams yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {t.guestTeams.map((name) => (
              <li
                key={name}
                className="rounded-card border border-border bg-surface p-3 font-bold"
              >
                {name}
              </li>
            ))}
          </ul>
        )}
        {t.signup === "open" ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-h3">Bring a team from another league</h3>
            <p className="max-w-prose text-text-muted">
              Captains sign up with a team name and a head count. Your players
              don&apos;t need accounts: each one signs the waiver with a link
              you share.
              {t.maxGuestTeams !== null &&
                ` There's room for ${t.maxGuestTeams} guest teams.`}
            </p>
            <GuestSignupForm slug={slug} />
          </div>
        ) : (
          SIGNUP_NOTES[t.signup] && (
            <p className="text-text-muted">{SIGNUP_NOTES[t.signup]}</p>
          )
        )}
      </section>

      {view && (
        <section aria-labelledby="bracket" className="flex flex-col gap-3">
          <h2 id="bracket" className="text-h2">
            Bracket
          </h2>
          <Champion bracket={view} />
          <BracketList bracket={view} headingLevel={3} />
        </section>
      )}
    </>
  );
}
