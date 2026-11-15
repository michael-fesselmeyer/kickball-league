import { SubmitButton } from "@/components/submit-button";
import { isSnoozed, type TurnDowns } from "@/domain/notifications/limits";
import { saveTurnDownsAction } from "./actions";

/**
 * Ways to get fewer messages without turning them off (issue #529): only
 * your team's news, league news as a weekly roundup, and a two-week snooze.
 * The same choices sit next to every email's unsubscribe link. A plain
 * form: it works before any JavaScript loads.
 */
export function TurnDownSettings({
  turnDowns,
  now,
  timeZone,
  saved,
}: {
  turnDowns: TurnDowns;
  now: Date;
  timeZone: string;
  saved: boolean;
}) {
  const snoozed = isSnoozed(turnDowns, now);
  const until =
    snoozed && turnDowns.snoozedUntil
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone,
        }).format(turnDowns.snoozedUntil)
      : null;
  return (
    <section
      id="turn-downs"
      aria-labelledby="turn-downs-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="turn-downs-heading" className="text-h2">
        Fewer messages, not none
      </h2>
      <p className="text-text-muted">
        Turn things down instead of off. Rain-outs, changes to your games and
        payment deadlines always come right away.
      </p>
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved.
        </p>
      )}
      <form action={saveTurnDownsAction} className="flex flex-col gap-4">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="teamOnly"
            defaultChecked={turnDowns.teamOnly}
            className="mt-1"
            aria-describedby="team-only-hint"
          />
          <span className="flex flex-col">
            Only my team
            <span id="team-only-hint" className="text-small text-text-muted">
              Skip news sent to the whole league. News from your captain still
              comes.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="weeklyNews"
            defaultChecked={turnDowns.weeklyNews}
            className="mt-1"
            aria-describedby="weekly-news-hint"
          />
          <span className="flex flex-col">
            League news as a weekly roundup
            <span id="weekly-news-hint" className="text-small text-text-muted">
              One email on Sunday evenings instead of one per message.
            </span>
          </span>
        </label>
        <SubmitButton className="min-h-11 self-start rounded-full border border-text px-4 py-1">
          Save
        </SubmitButton>
      </form>
      <form action={saveTurnDownsAction} className="flex flex-col gap-2">
        {until ? (
          <>
            <p>
              Snoozed until {until}. What can wait will come in one digest
              after.
            </p>
            <input type="hidden" name="snooze" value="end" />
            <SubmitButton className="min-h-11 self-start rounded-full border border-text px-4 py-1">
              End snooze now
            </SubmitButton>
          </>
        ) : (
          <>
            <p className="text-small text-text-muted">
              Busy stretch? Save up everything that can wait for two weeks.
            </p>
            <input type="hidden" name="snooze" value="start" />
            <SubmitButton className="min-h-11 self-start rounded-full border border-text px-4 py-1">
              Snooze for 2 weeks
            </SubmitButton>
          </>
        )}
      </form>
    </section>
  );
}
