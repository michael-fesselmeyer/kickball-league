import type { Rating } from "@/domain/discipline/discipline";
import { RATING_NOTE_MAX } from "@/domain/discipline/discipline";
import { SubmitButton } from "@/components/submit-button";

const LABELS = ["", "Poor", "Rough", "Fine", "Good", "Great"] as const;

/**
 * A captain's 1–5 rating of the other team, and a note only admins read.
 * Saving again changes the team's rating.
 */
export function SportsmanshipForm({
  action,
  opponent,
  current,
}: {
  action: (form: FormData) => Promise<void>;
  opponent: string;
  current: Rating | null;
}) {
  return (
    <section
      id="sportsmanship"
      aria-labelledby="sportsmanship-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h2 id="sportsmanship-heading" className="text-h3">
        Rate {opponent}&apos;s sportsmanship
      </h2>
      <p className="text-small text-text-muted">
        {current
          ? `Your team gave ${current.score} of 5. You can change it.`
          : "Admins see each team's average. Nobody sees who gave which rating."}
      </p>
      <form action={action} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1">Rating</legend>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="score"
                  value={n}
                  required
                  defaultChecked={current?.score === n}
                />
                {n}{" "}
                <span className="text-small text-text-muted">{LABELS[n]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1">
          Note for the admins (optional)
          <input
            name="note"
            maxLength={RATING_NOTE_MAX}
            defaultValue={current?.note ?? ""}
            className="rounded-md border border-border bg-surface px-2 py-1"
          />
        </label>
        <SubmitButton className="btn self-start btn-secondary">
          {current ? "Update rating" : "Save rating"}
        </SubmitButton>
      </form>
    </section>
  );
}
