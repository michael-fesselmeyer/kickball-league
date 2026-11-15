"use server";

import { headers } from "next/headers";
import { txDb } from "@/db/client";
import { saveAnswer } from "@/db/queries/interest";
import { type InterestFormId, parseId } from "@/domain/ids";
import { ANSWER_ERRORS, parseAnswer } from "@/domain/interest/interest";
import { canWrite } from "@/domain/platform/operator";
import { formStrings } from "@/lib/form";
import { allowInterestAnswer } from "@/lib/interest-limits";
import { currentSite } from "@/lib/platform/site";

export type InterestState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

/** Fields of an option's answer in the posted form: `option-<id>`. */
const OPTION_PREFIX = "option-";

/**
 * Takes an answer from the public interest form. No account, no cookie and
 * nothing read from earlier answers: the result is only this one's, and an
 * address that answered before gets the same reply as a new one. A honeypot
 * field is answered as if it worked, so a bot learns nothing.
 */
export async function sendInterest(
  _previous: InterestState,
  form: FormData,
): Promise<InterestState> {
  const site = await currentSite();
  if (site && !canWrite(site.status, false))
    return {
      status: "error",
      message: "The league is paused. Try again later.",
    };
  const raw = formStrings(form, ["formId", "email", "friends", "website"]);
  if (raw.website.trim() !== "") return { status: "sent" };
  const formId = parseId<InterestFormId>(raw.formId);
  if (!formId) return { status: "error", message: ANSWER_ERRORS.choice };
  const answers = new Map<string, string>();
  for (const [key, value] of form.entries())
    if (key.startsWith(OPTION_PREFIX) && typeof value === "string")
      answers.set(key.slice(OPTION_PREFIX.length), value);
  // The option ids must be ours before anything touches the database.
  const parsed = parseAnswer(
    { email: raw.email, friends: raw.friends, answers },
    [...answers.keys()].filter((id) => parseId(id) !== null),
  );
  if (!parsed.ok)
    return { status: "error", message: ANSWER_ERRORS[parsed.error] };
  const now = new Date();
  const h = await headers();
  const network =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (!(await allowInterestAnswer(network, parsed.value.email, now)))
    return {
      status: "error",
      message: "That's a lot of answers. Try again tomorrow.",
    };
  const saved = await saveAnswer(txDb, {
    formId,
    answer: parsed.value,
    now,
  });
  if (!saved.ok)
    return {
      status: "error",
      message:
        saved.error === "closed"
          ? "This form just closed. Thanks for your interest."
          : "That form changed. Reload the page and answer again.",
    };
  return { status: "sent" };
}
