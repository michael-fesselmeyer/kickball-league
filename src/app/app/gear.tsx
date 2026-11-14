import Link from "next/link";
import type { MyGearKit } from "@/db/queries/equipment";
import { GEAR_ERRORS, kitLine } from "@/domain/equipment/equipment";
import {
  answerHandoffAction,
  cancelHandoffAction,
  handOffAction,
  pickUpAction,
  returnHomeAction,
} from "./gear-actions";

const NOTICES: Record<string, string> = {
  handed: "Handed on. It's theirs once they confirm.",
  confirmed: "Got it. The kit is yours now.",
  declined: "Noted: the kit stays with whoever had it.",
  cancelled: "Handoff taken back. You still have the kit.",
  picked_up: "Picked up. The kit is yours now.",
  returned: "Back home. Thanks for bringing it.",
  reported: "Reported. The league will restock it.",
};

/**
 * The league gear this person has, is being handed or brings to a game
 * (issue #286), on their home screen: "You have Kit A: bring it to
 * McCarren Park, Field 2 by 6:30 PM", with the next tap to make.
 */
export function Gear({
  kits,
  timeZone,
  now,
  notice,
  error,
}: {
  kits: readonly MyGearKit[];
  timeZone: string;
  now: Date;
  notice: string | null;
  error: string | null;
}) {
  const noticeText = notice ? NOTICES[notice] : undefined;
  const errorText = error ? GEAR_ERRORS[error] : undefined;
  if (kits.length === 0 && !noticeText && !errorText) return null;
  return (
    <section
      id="gear"
      aria-labelledby="gear-heading"
      className="flex flex-col gap-2 rounded-card border-2 border-border p-4"
    >
      <h2 id="gear-heading" className="text-h3">
        <span aria-hidden="true">🎒 </span>League gear
      </h2>
      {noticeText && (
        <p role="status" className="text-success">
          {noticeText}
        </p>
      )}
      {errorText && (
        <p role="alert" className="text-danger">
          {errorText}
        </p>
      )}
      {kits.length > 0 && (
        <ul className="flex flex-col gap-3">
          {kits.map((k) => (
            <KitCard key={k.kitId} kit={k} timeZone={timeZone} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function KitCard({
  kit,
  timeZone,
  now,
}: {
  kit: MyGearKit;
  timeZone: string;
  now: Date;
}) {
  const incoming = kit.pending?.direction === "in" ? kit.pending : null;
  const outgoing = kit.pending?.direction === "out" ? kit.pending : null;
  const line = kit.game
    ? kitLine({
        kitName: kit.kitName,
        place: kit.game.place,
        startsAt: kit.game.startsAt,
        timeZone,
        now,
        status: kit.holding
          ? { kind: "holding" }
          : incoming
            ? { kind: "on_its_way" }
            : kit.holderName
              ? { kind: "with", name: kit.holderName }
              : { kind: "at_home", homeLocation: kit.homeLocation },
      })
    : kit.holding
      ? `You have ${kit.kitName}.`
      : `${kit.kitName} is on its way to you.`;
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-2">
      <p className="font-bold">{line}</p>
      {kit.game && (
        <p className="text-small text-text-muted">
          For {kit.game.teamAName} vs {kit.game.teamBName}
        </p>
      )}
      {incoming && (
        <>
          <p>{incoming.otherName} says they handed it to you.</p>
          <div className="flex flex-wrap gap-2">
            <form
              action={answerHandoffAction.bind(null, incoming.id, "confirm")}
            >
              <button type="submit" className="btn btn-primary">
                Got it
                <span className="sr-only">: I have {kit.kitName}</span>
              </button>
            </form>
            <form
              action={answerHandoffAction.bind(null, incoming.id, "decline")}
            >
              <button type="submit" className="btn btn-secondary">
                I don&apos;t have it
              </button>
            </form>
          </div>
        </>
      )}
      {outgoing && (
        <div className="flex flex-wrap items-center gap-2">
          <p>Waiting for {outgoing.otherName} to confirm.</p>
          <form action={cancelHandoffAction.bind(null, outgoing.id)}>
            <button type="submit" className="btn btn-secondary">
              Take it back
            </button>
          </form>
        </div>
      )}
      {kit.holding && !outgoing && (
        <div className="flex flex-wrap gap-2">
          {kit.handTo && (
            <form action={handOffAction.bind(null, kit.kitId)}>
              <button type="submit" className="btn btn-primary">
                I handed {kit.kitName} to {kit.handTo.name}
              </button>
            </form>
          )}
          <form action={returnHomeAction.bind(null, kit.kitId)}>
            <button type="submit" className="btn btn-secondary">
              It&apos;s back home
              <span className="sr-only">: {kit.kitName}</span>
            </button>
          </form>
        </div>
      )}
      {!kit.holding && !kit.pending && !kit.holderName && kit.game && (
        <form action={pickUpAction.bind(null, kit.kitId)}>
          <button type="submit" className="btn btn-primary">
            I picked up {kit.kitName}
          </button>
        </form>
      )}
      <Link
        href={`/app/equipment/${kit.kitId}/missing`}
        className="inline-flex min-h-11 items-center text-small underline"
      >
        Something missing from {kit.kitName}?
      </Link>
    </li>
  );
}
