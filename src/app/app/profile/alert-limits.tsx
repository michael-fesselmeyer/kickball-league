import { URGENT_LABELS } from "@/domain/notifications/kinds";
import {
  type AlertLimits,
  DEFAULT_QUIET_HOURS,
  DIGEST_HOUR,
  hourLabel,
  MAX_DAILY_CAP,
} from "@/domain/notifications/limits";
import { saveAlertLimitsAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

const CAPS = Array.from(
  { length: MAX_DAILY_CAP + 1 },
  (_, n) => MAX_DAILY_CAP - n,
);

const capLabel = (n: number) =>
  n === 0
    ? "None: everything that can wait comes in the digest"
    : `${n} ${n === 1 ? "message" : "messages"} a day`;

/**
 * How many messages that can wait the person takes a day, when the rest
 * come as a digest, and their quiet hours. A plain form: it works before
 * any JavaScript loads.
 */
export function AlertLimitsSettings({
  limits,
  timeZone,
  status,
}: {
  limits: AlertLimits;
  timeZone: string;
  status: "saved" | "invalid" | null;
}) {
  const quiet = limits.quietHours ?? DEFAULT_QUIET_HOURS;
  const digestAt = hourLabel(DIGEST_HOUR);
  return (
    <section
      id="alert-limits"
      aria-labelledby="alert-limits-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="alert-limits-heading" className="text-h2">
        How often we message you
      </h2>
      <p className="text-text-muted">
        News and reminders that can wait count toward a daily limit. Anything
        over it comes together in one digest email, so nothing is lost. Times
        are in the league&apos;s time zone ({timeZone}).
      </p>
      {status === "saved" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Message limits saved.
        </p>
      )}
      {status === "invalid" && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          Quiet hours need different start and end times.
        </p>
      )}
      <form action={saveAlertLimitsAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          Daily limit for news and reminders
          <select
            name="dailyCap"
            defaultValue={String(limits.dailyCap)}
            className="self-start rounded-lg border border-text px-3 py-2"
          >
            {CAPS.map((n) => (
              <option key={n} value={n}>
                {capLabel(n)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1">Digest</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="digest"
              value="daily"
              defaultChecked={limits.digest === "daily"}
            />
            Every evening at {digestAt}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="digest"
              value="weekly"
              defaultChecked={limits.digest === "weekly"}
            />
            Sundays at {digestAt}
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1">Quiet hours</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="quiet"
              value="on"
              defaultChecked={limits.quietHours !== null}
              aria-describedby="quiet-hint"
            />
            Hold news and reminders overnight
          </label>
          <p id="quiet-hint" className="text-small text-text-muted">
            They arrive when quiet hours end. Urgent messages still come, and
            phone notifications for them arrive without a sound.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              From
              <select
                name="quietStart"
                defaultValue={String(quiet.startHour)}
                className="rounded-lg border border-text px-3 py-2"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Until
              <select
                name="quietEnd"
                defaultValue={String(quiet.endHour)}
                className="rounded-lg border border-text px-3 py-2"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <details className="text-small">
          <summary className="cursor-pointer">
            What always comes right away
          </summary>
          <ul className="mt-2 list-disc pl-5 text-text-muted">
            {URGENT_LABELS.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </details>
        <SubmitButton className="min-h-11 self-start rounded-full border border-text px-4 py-1">
          Save message limits
        </SubmitButton>
      </form>
    </section>
  );
}
