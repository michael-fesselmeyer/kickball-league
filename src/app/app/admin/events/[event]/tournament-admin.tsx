import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import type { EventDetails } from "@/db/queries/events";
import { friendDirectory } from "@/db/queries/friends";
import { adminGuestTeams, tournamentOf } from "@/db/queries/tournaments";
import { roundName } from "@/domain/playoffs/playoffs";
import { localDay } from "@/domain/schedule/public-game";
import { localTime } from "@/domain/time/zoned";
import { nameOf } from "@/domain/tournaments/bracket";
import {
  guestDataDeleteAt,
  signedLine,
} from "@/domain/tournaments/tournament";
import { absoluteUrl } from "@/lib/site";
import {
  drawBracketAction,
  removeGuestTeamAction,
  resetBracketAction,
  saveTournamentAction,
  scheduleGameAction,
  scoreGameAction,
} from "../tournament-actions";
import { TOURNAMENT_ERRORS, TOURNAMENT_SAVED } from "../tournament-messages";

const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

const dollars = (cents: number | null) =>
  cents === null ? "" : String(cents / 100);

const when = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);

/**
 * The tournament panel on an event's admin page: guest sign-up settings,
 * the charity link, the partner league, each guest team and its waiver
 * count, and the bracket with its scores and fields.
 */
export async function TournamentAdmin({
  e,
  origin,
  saved,
  error,
}: {
  e: EventDetails;
  origin: string;
  saved: string | undefined;
  error: string | undefined;
}) {
  const [t, teams, friends] = await Promise.all([
    tournamentOf(db, e.id),
    adminGuestTeams(db, e.id),
    friendDirectory(db, e.leagueId),
  ]);
  const bracket = t?.bracket ?? null;
  const tz = e.timeZone;
  return (
    <section
      id="tournament"
      aria-labelledby="tournament-h"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="tournament-h" className="text-h2">
        Guest teams and charity
      </h2>
      {error && TOURNAMENT_ERRORS[error] && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {TOURNAMENT_ERRORS[error]}
        </p>
      )}
      {saved && TOURNAMENT_SAVED[saved] && (
        <p role="status" className="rounded-lg border border-success p-3">
          {TOURNAMENT_SAVED[saved]}
        </p>
      )}

      <form
        action={saveTournamentAction.bind(null, e.slug)}
        className="flex flex-col gap-3"
      >
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="guestSignupsOpen"
            defaultChecked={t?.guestSignupsOpen ?? true}
            className="size-5 accent-brand"
          />
          Take guest teams from other leagues (the public page shows a sign-up)
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Most guest teams{" "}
          <span className="font-normal text-text-muted">(blank for no cap)</span>
          <input
            name="maxGuestTeams"
            inputMode="numeric"
            defaultValue={t?.maxGuestTeams ?? ""}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Partner league{" "}
          <span className="font-normal text-text-muted">
            (adds a card for this tournament on the Friends page)
          </span>
          <select
            name="partnerFriendLeagueId"
            defaultValue={t?.partnerFriendLeagueId ?? ""}
            className={input}
          >
            <option value="">None</option>
            {friends.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
          <legend className="px-1 font-bold">Charity (optional)</legend>
          <p className="text-small text-text-muted">
            The page shows a link and a goal. The league never takes or holds
            donations.
          </p>
          <label className="flex flex-col gap-1 font-medium">
            Charity name
            <input
              name="charityName"
              maxLength={80}
              defaultValue={t?.charityName ?? ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Donation link (https)
            <input
              name="charityUrl"
              type="url"
              maxLength={300}
              defaultValue={t?.charityUrl ?? ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Goal in dollars{" "}
            <span className="font-normal text-text-muted">(optional)</span>
            <input
              name="charityGoal"
              inputMode="decimal"
              defaultValue={dollars(t?.charityGoalCents ?? null)}
              className={input}
            />
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 font-medium">
          Delete guest details this many days after the event
          <span className="font-normal text-text-muted">
            Captains&apos; names and emails and the waiver signatures. The
            bracket and scores stay.
            {t &&
              ` They go on ${when(guestDataDeleteAt(e.endsAt, t.guestDataDays), tz)}${t.guestDataDeletedAt ? " (already deleted)" : ""}.`}
          </span>
          <input
            name="guestDataDays"
            inputMode="numeric"
            defaultValue={t?.guestDataDays ?? 30}
            className={input}
          />
        </label>
        <SubmitButton className="btn btn-primary self-start">
          Save tournament settings
        </SubmitButton>
      </form>

      {t && (
        <>
          <h3 className="text-h3">Guest teams ({teams.length})</h3>
          {teams.length === 0 ? (
            <p className="text-text-muted">
              {t.guestDataDeletedAt
                ? "Guest details were deleted."
                : "No guest teams yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {teams.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-col gap-1 rounded-card border border-border p-3"
                >
                  <p className="font-bold">{g.name}</p>
                  <p>
                    {g.captainName}, {g.captainEmail}
                  </p>
                  <p className="text-small">
                    {signedLine(g.signed, g.rosterSize)}
                  </p>
                  <p className="text-small break-all text-text-muted">
                    Waiver link: {absoluteUrl(origin, `/guest/${g.linkToken}`)}
                  </p>
                  <form
                    action={removeGuestTeamAction.bind(null, e.slug, g.id)}
                  >
                    <SubmitButton className="btn btn-secondary">
                      Remove {g.name}
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <h3 className="text-h3">Bracket</h3>
          {!bracket ? (
            <form
              action={drawBracketAction.bind(null, e.slug)}
              className="flex flex-col items-start gap-2"
            >
              <p>
                Draw a single-elimination bracket from the guest teams. Sign-ups
                close once it&apos;s drawn.
              </p>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="order"
                  value="signup"
                  defaultChecked
                  className="size-5 accent-brand"
                />
                Seed in the order teams signed up
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="order"
                  value="random"
                  className="size-5 accent-brand"
                />
                Draw the seeds at random
              </label>
              <SubmitButton className="btn btn-primary">
                Draw the bracket
              </SubmitButton>
            </form>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {bracket.matches.map((m) => {
                  const a = nameOf(bracket, m.teamA);
                  const b = nameOf(bracket, m.teamB);
                  const rounds = Math.max(...bracket.matches.map((x) => x.round));
                  const at = m.startsAt ? new Date(m.startsAt) : null;
                  return (
                    <li
                      key={m.code}
                      className="flex flex-col gap-2 rounded-card border border-border p-3"
                    >
                      <p className="font-bold">
                        {roundName(m.round, rounds)}, game {m.position}:{" "}
                        {a ?? "To be decided"} vs {b ?? "To be decided"}
                      </p>
                      {m.teamA && m.teamB && (
                        <form
                          action={scoreGameAction.bind(null, e.slug, m.code)}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <label className="flex flex-col gap-1 text-small">
                            {a} runs
                            <input
                              name="scoreA"
                              inputMode="numeric"
                              defaultValue={m.scoreA ?? ""}
                              className={`${input} w-24`}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-small">
                            {b} runs
                            <input
                              name="scoreB"
                              inputMode="numeric"
                              defaultValue={m.scoreB ?? ""}
                              className={`${input} w-24`}
                            />
                          </label>
                          <SubmitButton className="btn btn-secondary">
                            Save score
                          </SubmitButton>
                        </form>
                      )}
                      <form
                        action={scheduleGameAction.bind(null, e.slug, m.code)}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <label className="flex flex-col gap-1 text-small">
                          Field
                          <input
                            name="place"
                            maxLength={60}
                            defaultValue={m.place ?? ""}
                            className={input}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-small">
                          Date
                          <input
                            type="date"
                            name="date"
                            defaultValue={at ? localDay(at, tz) : ""}
                            className={input}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-small">
                          Time
                          <input
                            type="time"
                            name="time"
                            defaultValue={at ? localTime(at, tz) : ""}
                            className={input}
                          />
                        </label>
                        <SubmitButton className="btn btn-secondary">
                          Save field and time
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
              <form action={resetBracketAction.bind(null, e.slug)}>
                <SubmitButton className="btn btn-secondary">
                  Reset the bracket
                </SubmitButton>
                <span className="ml-2 text-small text-text-muted">
                  Only before any game is played.
                </span>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}
