import { SubmitButton } from "@/components/submit-button";
import type { GameCardRow } from "@/db/queries/cards";
import type { GamePerson } from "@/db/queries/discipline";
import {
  CARD_COLOR_KEYS,
  CARD_COLORS,
  CARD_NOTE_MAX,
  cardChoice,
  cardName,
  canUndoCard,
} from "@/domain/discipline/cards";
import { giveCardAction, undoCardAction } from "./cards";

const field = "rounded-md border border-border bg-surface px-2 py-2";

/**
 * The ref's card tool on the score screen: give a yellow or red card with an
 * optional note, and see the cards given, with an undo for a few minutes.
 * Only admins and the game's ref see it; no card is ever public.
 */
export function CardsSection({
  gameId,
  teams,
  people,
  cards,
  viewer,
  now,
  canGive,
  timeZone,
}: {
  gameId: string;
  teams: readonly { id: string; name: string }[];
  people: readonly GamePerson[];
  cards: readonly GameCardRow[];
  viewer: { userId: string; isAdmin: boolean };
  now: Date;
  canGive: boolean;
  timeZone: string;
}) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return (
    <section
      id="cards"
      aria-labelledby="cards-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h2 id="cards-heading" className="text-h3">
        Cards
      </h2>
      <p className="text-small text-text-muted">
        A calm-down tool. A yellow card is a warning; a red card asks the player
        to sit out the rest of the game. Only league admins see cards, and a
        card never suspends anyone.
      </p>
      {cards.length > 0 && (
        <ul className="flex flex-col">
          {cards.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
            >
              <span>
                <strong>
                  {cardName(c.color)}: {c.name}
                </strong>
                <span className="text-small text-text-muted">
                  {c.teamName ? ` · ${c.teamName}` : ""} ·{" "}
                  {time.format(c.givenAt)}
                  {c.note ? ` · ${c.note}` : ""}
                </span>
              </span>
              {canUndoCard(c, viewer, now) && (
                <form action={undoCardAction.bind(null, gameId, c.id)}>
                  <SubmitButton className="btn btn-secondary">
                    Undo {cardName(c.color).toLowerCase()} for {c.name}
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {!canGive && (
        <p className="text-small text-text-muted">
          A ref can give cards from kickoff until two days after the game.
        </p>
      )}
      {canGive && (
        <form
          action={giveCardAction.bind(null, gameId)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="card-person">Player</label>
            <select
              id="card-person"
              name="person"
              required
              defaultValue=""
              className={field}
            >
              <option value="" disabled>
                Choose a player
              </option>
              {teams.map((t) => (
                <optgroup key={t.id} label={t.name}>
                  {people
                    .filter((p) => p.teamSeasonId === t.id)
                    .map((p) => (
                      <option key={p.userId} value={cardChoice(t.id, p.userId)}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1">Card</legend>
            {CARD_COLOR_KEYS.map((color, i) => (
              <label key={color} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="color"
                  value={color}
                  required
                  defaultChecked={i === 0}
                />
                {CARD_COLORS[color]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="card-note">Short note (optional)</label>
            <input
              id="card-note"
              name="note"
              maxLength={CARD_NOTE_MAX}
              className={field}
            />
          </div>
          <SubmitButton className="btn self-start btn-primary">
            Give the card
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
