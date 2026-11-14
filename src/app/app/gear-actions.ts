"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  answerHandoff,
  cancelHandoff,
  handOffKit,
  pickUpKit,
  returnKitHome,
} from "@/db/queries/equipment";
import {
  type EquipmentHandoffId,
  type EquipmentKitId,
  parseId,
} from "@/domain/ids";
import { requireSelfToChange } from "@/lib/auth/permission";

/**
 * The one-tap gear actions on the home screen (issue #286). Each is the
 * person acting for themselves; whether they have the kit, are handed it or
 * bring it to a game is checked against the kit under its lock.
 */

const HOME = "/app";
const back = (code: string, kind: "notice" | "error") =>
  redirect(`${HOME}?gear_${kind}=${code}#gear`);

const kitOf = (raw: string) => {
  const id = parseId<EquipmentKitId>(raw);
  if (!id) notFound();
  return id;
};

const handoffOf = (raw: string) => {
  const id = parseId<EquipmentHandoffId>(raw);
  if (!id) notFound();
  return id;
};

/** "I handed Kit A to Sam". */
export async function handOffAction(rawKitId: string): Promise<void> {
  const subject = await requireSelfToChange("equipment.carry", HOME);
  const kitId = kitOf(rawKitId);
  const done = await txDb.transaction((tx) =>
    handOffKit(tx, { kitId, actorId: subject.userId, now: new Date() }),
  );
  if (!done.ok) back(done.error, "error");
  back("handed", "notice");
}

/** "Got it" or "I don't have it", from the receiver. */
export async function answerHandoffAction(
  rawHandoffId: string,
  answer: "confirm" | "decline",
): Promise<void> {
  const subject = await requireSelfToChange("equipment.carry", HOME);
  const handoffId = handoffOf(rawHandoffId);
  // Bound arguments come back from the browser, so check them again.
  if (answer !== "confirm" && answer !== "decline") notFound();
  const done = await txDb.transaction((tx) =>
    answerHandoff(tx, {
      handoffId,
      actorId: subject.userId,
      answer,
      now: new Date(),
    }),
  );
  if (!done.ok) back(done.error, "error");
  back(answer === "confirm" ? "confirmed" : "declined", "notice");
}

/** The giver takes a handoff back before it is answered. */
export async function cancelHandoffAction(rawHandoffId: string): Promise<void> {
  const subject = await requireSelfToChange("equipment.carry", HOME);
  const handoffId = handoffOf(rawHandoffId);
  const done = await txDb.transaction((tx) =>
    cancelHandoff(tx, { handoffId, actorId: subject.userId, now: new Date() }),
  );
  if (!done.ok) back(done.error, "error");
  back("cancelled", "notice");
}

/** "I picked it up" from the kit's home. */
export async function pickUpAction(rawKitId: string): Promise<void> {
  const subject = await requireSelfToChange("equipment.carry", HOME);
  const kitId = kitOf(rawKitId);
  const done = await txDb.transaction((tx) =>
    pickUpKit(tx, { kitId, actorId: subject.userId, now: new Date() }),
  );
  if (!done.ok) back(done.error, "error");
  back("picked_up", "notice");
}

/** "It's back home". */
export async function returnHomeAction(rawKitId: string): Promise<void> {
  const subject = await requireSelfToChange("equipment.carry", HOME);
  const kitId = kitOf(rawKitId);
  const done = await txDb.transaction((tx) =>
    returnKitHome(tx, { kitId, actorId: subject.userId, now: new Date() }),
  );
  if (!done.ok) back(done.error, "error");
  back("returned", "notice");
}
