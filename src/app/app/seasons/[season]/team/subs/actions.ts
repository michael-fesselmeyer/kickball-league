"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import {
  cancelSubRequest,
  claimTeam,
  decideSubClaim,
  postSubRequest,
  requestTeam,
} from "@/db/queries/subs";
import { can } from "@/domain/authz/permissions";
import {
  type GameId,
  parseId,
  type SubClaimId,
  type SubRequestId,
} from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { sendQueuedSoon } from "@/services/outbox";

const pageOf = (slug: string) => `/app/seasons/${slug}/team/subs`;

/** The signed-in captain (or co-captain, or admin) and their team. */
async function captain(slug: string) {
  const page = pageOf(slug);
  const subject = await requirePermission("registration.join", { next: page });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const teamSeasonId = mine?.team?.teamSeasonId;
  if (!teamSeasonId || !can(subject, "sub_request.post", { teamSeasonId }))
    notFound();
  return { subject, teamSeasonId, page };
}

const count = (value: string) => {
  const n = Number(value === "" ? "0" : value);
  return Number.isInteger(n) ? n : -1;
};

/** Posts a sub request for one of the team's games and tells eligible players. */
export async function postSubRequestAction(
  slug: string,
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const { subject, teamSeasonId, page } = await captain(slug);
  const gameId = parseId<GameId>(rawGameId);
  if (!gameId) notFound();
  const values = formStrings(form, [
    "needed",
    "womenNeeded",
    "menNeeded",
    "note",
  ] as const);
  const note = values.note.trim().slice(0, 500);
  const result = await postSubRequest(txDb, {
    gameId,
    teamSeasonId,
    requestedBy: subject.userId,
    spots: {
      needed: count(values.needed),
      womenNeeded: count(values.womenNeeded),
      menNeeded: count(values.menNeeded),
    },
    note: note === "" ? null : note,
    now: new Date(),
  });
  if (!result.ok) redirect(`${page}?game=${gameId}&error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?posted=${result.value.notified}`);
}

/** Approves or declines a claim on one of the team's requests. */
export async function decideClaimAction(
  slug: string,
  rawClaimId: string,
  decision: "approved" | "declined",
): Promise<void> {
  const { subject, page } = await captain(slug);
  const claimId = parseId<SubClaimId>(rawClaimId);
  const teamSeasonId = claimId ? await claimTeam(db, claimId) : null;
  if (
    !claimId ||
    !teamSeasonId ||
    !can(subject, "sub_request.decide", { teamSeasonId })
  )
    notFound();
  const result = await decideSubClaim(txDb, {
    claimId,
    decidedBy: subject.userId,
    decision,
    now: new Date(),
  });
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?notice=${decision}`);
}

/** Takes a request down; anyone holding a spot hears they are not playing. */
export async function cancelRequestAction(
  slug: string,
  rawRequestId: string,
): Promise<void> {
  const { subject, page } = await captain(slug);
  const requestId = parseId<SubRequestId>(rawRequestId);
  const teamSeasonId = requestId ? await requestTeam(db, requestId) : null;
  if (
    !requestId ||
    !teamSeasonId ||
    !can(subject, "sub_request.decide", { teamSeasonId })
  )
    notFound();
  const result = await cancelSubRequest(txDb, { requestId, now: new Date() });
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  sendQueuedSoon();
  redirect(`${page}?notice=cancelled`);
}
