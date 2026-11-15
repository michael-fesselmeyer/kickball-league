import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { ejectedIn, gamePeople } from "@/db/queries/discipline";
import type { ScoringGame } from "@/db/queries/scores";
import { EJECTION_REASON_MAX } from "@/domain/discipline/discipline";
import { ejectAction } from "./actions";

/** What went wrong ejecting a player, by error code from the URL. */
export const EJECT_ERRORS: Record<string, string> = {
  no_person: "Choose the player to eject.",
  unknown_person: "That player isn't on either team in this game.",
  already_ejected: "That player is already ejected from this game.",
  details_too_long: `Keep the reason under ${EJECTION_REASON_MAX} characters.`,
  not_started: "This game hasn't started yet.",
  called_off: "This game was called off.",
};

const field = "min-h-11 rounded-md border border-border bg-surface px-2 py-2";

/**
 * The ref's "Eject a player": files an ejection report for admins and takes
 * the player out of their team's kicking order for the rest of the game.
 */
export async function EjectSection({
  game,
  ejectedNotice,
}: {
  game: Pick<
    ScoringGame,
    "id" | "teamAId" | "teamBId" | "teamAName" | "teamBName"
  >;
  ejectedNotice: boolean;
}) {
  const [people, ejected] = await Promise.all([
    gamePeople(db, game),
    ejectedIn(db, game.id),
  ]);
  const out = people.filter((p) => ejected.has(p.userId));
  const teams = [
    { id: game.teamAId, name: game.teamAName },
    { id: game.teamBId, name: game.teamBName },
  ];
  return (
    <section
      id="eject"
      aria-labelledby="eject-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h2 id="eject-heading" className="text-h3">
        Eject a player
      </h2>
      {ejectedNotice && (
        <p role="status" className="rounded-lg border border-success p-3">
          Ejected. They&apos;re out of the kicking order for the rest of the
          game, and the league has the report.
        </p>
      )}
      {out.length > 0 && (
        <p className="text-small">
          Ejected this game: {out.map((p) => p.name).join(", ")}.
        </p>
      )}
      <form
        action={ejectAction.bind(null, game.id)}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1">
          Player
          <select name="person" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose a player
            </option>
            {teams.map((t) => (
              <optgroup key={t.id} label={t.name}>
                {people
                  .filter(
                    (p) => p.teamSeasonId === t.id && !ejected.has(p.userId),
                  )
                  .map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Reason (optional)
          <textarea
            name="reason"
            rows={2}
            maxLength={EJECTION_REASON_MAX}
            className={field}
          />
        </label>
        <p className="text-small text-text-muted">
          They leave the kicking order and can&apos;t play defense for the rest
          of this game. The league reviews the report and decides on anything
          more.
        </p>
        <SubmitButton className="btn self-start btn-secondary">
          Eject the player
        </SubmitButton>
      </form>
    </section>
  );
}
