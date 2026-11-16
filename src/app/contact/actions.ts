"use server";

import { headers } from "next/headers";
import { db } from "@/db/client";
import { submitConcern } from "@/db/queries/concerns";
import { defaultLeague } from "@/db/queries/leagues";
import {
  CONCERN_ERRORS,
  type ConcernError,
  PUBLIC_CATEGORIES,
  parseConcern,
} from "@/domain/concerns/concerns";
import { formStrings } from "@/lib/form";
import { allowPublicConcern } from "@/lib/contact-limits";
import { canWrite } from "@/domain/platform/operator";
import { currentSite } from "@/lib/platform/site";
import { sendQueuedSoon } from "@/services/outbox";

export type ContactState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string; field?: ConcernError };

const FIELDS = [
  "category",
  "parkRule",
  "body",
  "occurredOn",
  "place",
  "replyEmail",
  "website",
] as const;

/** More than two links is how spam looks; real messages rarely have any. */
const looksLikeSpam = (body: string) =>
  (body.match(/https?:\/\/|www\./gi) ?? []).length > 2;

/**
 * Takes a message from the public contact form. No account, no cookie and
 * nothing read from earlier submissions: the result is only this one's.
 * Free spam protection: a honeypot field that people never see (answered
 * as if it worked, so a bot learns nothing), a link cap, and rate limits
 * per address, per network and overall.
 */
export async function sendContact(
  _previous: ContactState,
  form: FormData,
): Promise<ContactState> {
  // No account, so the same stop the signed-in actions have while the site is
  // read-only or paused.
  const site = await currentSite();
  if (site && !canWrite(site.status, false))
    return {
      status: "error",
      message: "The league is paused. Try again later.",
    };
  const raw = formStrings(form, FIELDS);
  if (raw.website.trim() !== "") return { status: "sent" };
  const now = new Date();
  const parsed = parseConcern(
    raw,
    Object.keys(PUBLIC_CATEGORIES),
    now.toISOString().slice(0, 10),
  );
  if (!parsed.ok)
    return {
      status: "error",
      message: CONCERN_ERRORS[parsed.error],
      field: parsed.error,
    };
  if (looksLikeSpam(parsed.value.body))
    return { status: "error", message: "Leave the links out and send it again." };
  const h = await headers();
  const network =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (!(await allowPublicConcern(network, parsed.value.replyEmail, now)))
    return {
      status: "error",
      message: "That's a lot of messages. Try again tomorrow.",
    };
  const league = await defaultLeague(db);
  if (!league)
    return { status: "error", message: "Messages aren't going through right now. Try again later." };
  await submitConcern(db, {
    leagueId: league.id,
    leagueName: league.name,
    source: "public",
    senderId: null,
    form: parsed.value,
    now,
  });
  sendQueuedSoon();
  return { status: "sent" };
}
