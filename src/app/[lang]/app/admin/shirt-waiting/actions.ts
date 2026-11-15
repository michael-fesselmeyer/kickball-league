"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  handOutSpare,
  logSpare,
  markBatchOrdered,
  receiveBatch,
} from "@/db/queries/shirt-late";
import { parseId, type RegistrationId } from "@/domain/ids";
import { parseSpare } from "@/domain/shirts/late";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { todayIn } from "./today";

const PAGE = "/app/admin/shirt-waiting";

async function adminOfLeague() {
  const subject = await requirePermissionToChange("shirts.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
  if (!league) notFound();
  return { subject, league };
}

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** An admin logs spare shirts left from an earlier order. */
export async function logSpareAction(form: FormData): Promise<void> {
  const { subject, league } = await adminOfLeague();
  const parsed = parseSpare({
    size: text(form, "size"),
    quantity: text(form, "quantity"),
    note: text(form, "note"),
  });
  if (!parsed.ok) redirect(`${PAGE}?error=${parsed.error}#spares`);
  await txDb.transaction((tx) =>
    logSpare(tx, {
      leagueId: league.id,
      size: parsed.value.size,
      quantity: parsed.value.quantity,
      note: parsed.value.note,
      actorId: subject.userId,
    }),
  );
  redirect(`${PAGE}?notice=spare_logged#spares`);
}

/** An admin hands a spare shirt to a waiting player. */
export async function handOutSpareAction(
  registrationId: string,
): Promise<void> {
  const { subject, league } = await adminOfLeague();
  const id = parseId<RegistrationId>(registrationId);
  if (!id) notFound();
  const result = await txDb.transaction((tx) =>
    handOutSpare(tx, {
      leagueId: league.id,
      registrationId: id,
      actorId: subject.userId,
    }),
  );
  redirect(
    result.ok
      ? `${PAGE}?notice=handed_out#waiting`
      : `${PAGE}?error=${result.error}#waiting`,
  );
}

/** The batch reorder was placed: everyone still waiting is marked ordered. */
export async function batchOrderedAction(): Promise<void> {
  const { subject, league } = await adminOfLeague();
  const count = await txDb.transaction((tx) =>
    markBatchOrdered(tx, {
      leagueId: league.id,
      actorId: subject.userId,
      today: todayIn(league.timeZone),
    }),
  );
  redirect(`${PAGE}?notice=batch_ordered&n=${count}`);
}

/** The batch arrived: its shirts are marked received. */
export async function batchReceivedAction(): Promise<void> {
  const { subject, league } = await adminOfLeague();
  const count = await txDb.transaction((tx) =>
    receiveBatch(tx, { leagueId: league.id, actorId: subject.userId }),
  );
  redirect(`${PAGE}?notice=batch_received&n=${count}`);
}
