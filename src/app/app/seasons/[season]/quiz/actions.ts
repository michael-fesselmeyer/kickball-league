"use server";

import { randomInt } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import {
  joinFriendGroup,
  leaveFriendGroup,
  saveQuiz,
  startFriendGroup,
} from "@/db/queries/free-agents";
import { seasonForRegistration } from "@/db/queries/registration";
import { currentLeague } from "@/db/queries/seasons";
import { normalizeFriendCode } from "@/domain/matcher/friend-code";
import { parseQuiz } from "@/domain/matcher/quiz";
import { requireSelf } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/seasons/${slug}/quiz`;

/** The signed-in person and the season, for their own quiz and group. */
async function context(slug: string) {
  const subject = await requireSelf("profile.edit", pageFor(slug));
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  return { userId: subject.userId, seasonId: season.id };
}

/** A float in [0, 1) from the crypto source, for friend codes. */
const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

export async function saveQuizAction(slug: string, form: FormData) {
  const { userId, seasonId } = await context(slug);
  const parsed = parseQuiz({
    experience: form.get("experience"),
    positions: form.getAll("positions"),
    availability: form.get("availability"),
    vibe: form.get("vibe"),
    captain: form.get("captain"),
    notes: form.get("notes"),
  });
  if (!parsed.ok) redirect(`${pageFor(slug)}?error=${parsed.error}`);
  const saved = await saveQuiz(db, { seasonId, userId, quiz: parsed.value });
  if (!saved.ok) redirect(`${pageFor(slug)}?error=${saved.error}`);
  redirect(`/app/seasons/${slug}?quiz=saved`);
}

export async function startGroupAction(slug: string) {
  const { userId, seasonId } = await context(slug);
  const started = await startFriendGroup(db, {
    seasonId,
    userId,
    random: secureRandom,
  });
  if (!started.ok) redirect(`${pageFor(slug)}?error=${started.error}`);
  redirect(`${pageFor(slug)}?notice=group_started#friends`);
}

export async function joinGroupAction(slug: string, form: FormData) {
  const { userId, seasonId } = await context(slug);
  const raw = form.get("code");
  const code = typeof raw === "string" ? normalizeFriendCode(raw) : null;
  if (!code) redirect(`${pageFor(slug)}?error=bad_code#friends`);
  const joined = await joinFriendGroup(db, { seasonId, userId, code });
  if (!joined.ok) redirect(`${pageFor(slug)}?error=${joined.error}#friends`);
  redirect(`${pageFor(slug)}?notice=group_joined#friends`);
}

export async function leaveGroupAction(slug: string) {
  const { userId, seasonId } = await context(slug);
  const left = await leaveFriendGroup(db, { seasonId, userId });
  if (!left.ok) redirect(`${pageFor(slug)}?error=${left.error}#friends`);
  redirect(`${pageFor(slug)}?notice=group_left#friends`);
}
