"use server";

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { db, txDb } from "@/db/client";
import {
  registerGuestTeam,
  signGuestWaiver,
} from "@/db/queries/tournaments";
import { event } from "@/db/schema/event";
import { canWrite } from "@/domain/platform/operator";
import {
  GUEST_SIGNUP_ERRORS,
  parseGuestSignature,
  parseGuestSignup,
} from "@/domain/tournaments/tournament";
import { formStrings } from "@/lib/form";
import { allowGuestSignature, allowGuestSignup } from "@/lib/guest-limits";
import { currentSite } from "@/lib/platform/site";
import { refreshEventPages } from "@/lib/public-cache";

export type GuestSignupState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; teamName: string; token: string };

export type GuestSignState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "signed"; name: string };

const PAUSED = "The league is paused. Try again later.";

/** The caller's network, as the contact form reads it. */
async function networkOf(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

const CLOSED_LINES = {
  closed: "Guest sign-ups for this tournament are closed.",
  full: "Every guest spot is taken.",
  over: "This tournament is over.",
  cancelled: "This tournament was called off.",
  name_taken: "A team with that name is already in. Pick another name.",
  not_a_tournament: "This tournament isn't taking guest teams.",
} as const;

/**
 * A guest captain enters a team: no account, no cookie. Spam protection is
 * free: a honeypot, and limits per address, per network and overall.
 */
export async function signUpGuestTeam(
  slug: string,
  _previous: GuestSignupState,
  form: FormData,
): Promise<GuestSignupState> {
  const site = await currentSite();
  if (site && !canWrite(site.status, false))
    return { status: "error", message: PAUSED };
  const raw = formStrings(form, [
    "teamName",
    "captainName",
    "captainEmail",
    "rosterSize",
    "website",
  ] as const);
  const parsed = parseGuestSignup(raw);
  if (raw.website.trim() !== "")
    return { status: "done", teamName: raw.teamName, token: "x".repeat(32) };
  if (!parsed.ok)
    return { status: "error", message: GUEST_SIGNUP_ERRORS[parsed.error] };
  const now = new Date();
  if (!(await allowGuestSignup(await networkOf(), parsed.value.captainEmail, now)))
    return {
      status: "error",
      message: "That's a lot of sign-ups. Try again tomorrow.",
    };
  const [found] = await db
    .select({ id: event.id })
    .from(event)
    .where(
      and(
        eq(event.slug, slug),
        eq(event.audience, "public"),
        isNull(event.deletedAt),
      ),
    );
  if (!found)
    return { status: "error", message: CLOSED_LINES.not_a_tournament };
  const result = await txDb.transaction((tx) =>
    registerGuestTeam(tx, { eventId: found.id, signup: parsed.value, now }),
  );
  if (!result.ok)
    return { status: "error", message: CLOSED_LINES[result.error] };
  refreshEventPages(slug);
  return {
    status: "done",
    teamName: parsed.value.teamName,
    token: result.value.linkToken,
  };
}

const SIGN_ERRORS = {
  no_team: "This link doesn't work. Ask your captain for a new one.",
  no_waiver: "The league hasn't published its waiver yet. Try again later.",
  changed:
    "The waiver was updated while you were reading it. Reload the page and read it again.",
  over: "This tournament is over, so the waiver is closed.",
  roster_full:
    "Everyone on this roster has signed. Ask your captain to check the head count.",
  already_signed: "Someone already signed with that name on this team.",
} as const;

/** A guest player signs the waiver through their captain's link. */
export async function signGuestWaiverAction(
  token: string,
  shownSha256: string,
  _previous: GuestSignState,
  form: FormData,
): Promise<GuestSignState> {
  const site = await currentSite();
  if (site && !canWrite(site.status, false))
    return { status: "error", message: PAUSED };
  const parsed = parseGuestSignature(formStrings(form, ["signedName", "agree"] as const));
  if (!parsed.ok)
    return {
      status: "error",
      message:
        parsed.error === "name"
          ? "Type your full name to sign."
          : "Tick the box to say you've read and agree to the waiver.",
    };
  const now = new Date();
  if (!(await allowGuestSignature(await networkOf(), token, now)))
    return { status: "error", message: "That's a lot of tries. Come back later." };
  const result = await txDb.transaction((tx) =>
    signGuestWaiver(tx, {
      token,
      signedName: parsed.value.signedName,
      shownSha256,
      now,
    }),
  );
  if (!result.ok)
    return { status: "error", message: SIGN_ERRORS[result.error] };
  return { status: "signed", name: parsed.value.signedName };
}
