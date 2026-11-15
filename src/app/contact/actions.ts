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
    return { status: "error", message: "Please leave out the links." };
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
    return { status: "error", message: "We can't take messages just now." };
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
