import type { TeamRsvps } from "@/db/queries/rsvps";
import { SubmitButton } from "@/components/submit-button";

const LEVEL_STYLE = {
  full: "text-success",
  short: "text-text",
  check: "text-warning",
  forfeit: "text-danger",
} as const;

const ANSWER = { in: "In", maybe: "Maybe", out: "Out" } as const;

/**
 * One game's In / Maybe / Out buttons, the team's counts and the fielding
 * check. Used on the team page and on Home's next-game card. A polite live
 * region says the answer after a tap ("You're Maybe for Tue, Nov 24"), since
 * the pressed state alone changes silently.
 */
export function Rsvp({
  action,
  mine,
  team,
  suspended,
  when,
  counts = true,
}: {
  action: (form: FormData) => Promise<void>;
  mine: "in" | "out" | "maybe" | null;
  team: TeamRsvps | undefined;
  /** A suspended player can't say they're in. */
  suspended: boolean;
  /** The game's day, as said in the announcement: "Tue, Nov 24". */
  when: string;
  /** Show the team's counts and the fielding check under the buttons. */
  counts?: boolean;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <span className="text-small text-text-muted">You:</span>
        {(["in", "maybe", "out"] as const).map((value) => (
          <SubmitButton
            key={value}
            name="status"
            value={value}
            aria-pressed={mine === value}
            disabled={suspended && value === "in"}
            className={`min-h-11 min-w-11 rounded-full border px-3 py-0.5 text-small disabled:opacity-50 ${
              mine === value
                ? "border-text bg-text text-surface"
                : "border-border"
            }`}
          >
            {ANSWER[value]}
          </SubmitButton>
        ))}
      </form>
      {/* aria-live without role="status": one per game, and the page keeps
          its own status message for notices. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {mine ? `You're ${ANSWER[mine]} for ${when}.` : ""}
      </p>
      {counts &&
        (team && team.in === 0 ? (
          <p className="text-small text-text-muted">
            Nobody has said they&apos;re in yet. {team.maybe} maybe · {team.out}{" "}
            out · {team.noAnswer} no answer.
          </p>
        ) : (
          team && (
            <p className="text-small">
              <span className="text-text-muted">
                {team.in} in · {team.maybe} maybe · {team.out} out ·{" "}
                {team.noAnswer} no answer.{" "}
              </span>
              <span className={LEVEL_STYLE[team.fielding.level]}>
                {team.fielding.message}
              </span>
            </p>
          )
        ))}
    </div>
  );
}
