"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import {
  type Curation,
  connectedAccounts,
  curatePost,
  disconnect,
  setShowNewest,
} from "@/db/queries/social";
import {
  type EventId,
  parseId,
  type SocialPostId,
  type TeamId,
} from "@/domain/ids";
import { env } from "@/env";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { refreshPhotoPages } from "@/lib/public-cache";
import { completeConnection } from "@/lib/social/connect";
import { instagramConfig, signInUrl } from "@/lib/social/instagram-app";
import {
  newState,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_MAX_AGE,
} from "@/lib/social/oauth-state";
import { syncAccount } from "@/lib/social/sync";
import { FIXTURE_CODE } from "@/services/instagram-fixture";
import { sendQueuedSoon } from "@/services/outbox";

const PAGE = "/app/admin/instagram";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

async function adminOfLeague() {
  const subject = await requirePermissionToChange("photos.manage", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  return { subject, league };
}

/**
 * Sends the admin to sign in on Instagram, with a state to check on return.
 * With the recorded fixture there is no Instagram screen to visit, so the
 * connection is finished here with the fixture's code.
 */
export async function connectInstagramAction() {
  const { subject, league } = await adminOfLeague();
  const config = instagramConfig();
  if (!config) redirect(`${PAGE}?error=off`);
  if (config.fixture) {
    const result = await completeConnection(config, {
      code: FIXTURE_CODE,
      leagueId: league.id,
      actorId: subject.userId,
    });
    refreshPhotoPages();
    redirect(`${PAGE}?${result}`);
  }
  const state = newState();
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.BETTER_AUTH_URL.startsWith("https:"),
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_MAX_AGE,
  });
  redirect(signInUrl(config, state));
}

/** Stops the sync and deletes the token; the admin chooses about the photos. */
export async function disconnectInstagramAction(form: FormData) {
  const { subject, league } = await adminOfLeague();
  const keepPhotos = text(form, "photos") !== "delete";
  await txDb.transaction((tx) =>
    disconnect(tx, {
      leagueId: league.id,
      keepPhotos,
      actorId: subject.userId,
    }),
  );
  refreshPhotoPages();
  redirect(`${PAGE}?done=${keepPhotos ? "disconnected" : "removed"}`);
}

/** Syncs now instead of waiting for the scheduled job. */
export async function syncNowAction() {
  const { league } = await adminOfLeague();
  const config = instagramConfig();
  if (!config) redirect(`${PAGE}?error=off`);
  const now = new Date();
  const account = (
    await connectedAccounts(txDb, env.BETTER_AUTH_SECRET, now)
  ).find((a) => a.leagueId === league.id);
  if (!account) redirect(`${PAGE}?error=not_connected`);
  const outcome = await syncAccount(txDb, config, account, now);
  refreshPhotoPages();
  if ("error" in outcome) {
    sendQueuedSoon();
    redirect(`${PAGE}?error=sync`);
  }
  redirect(`${PAGE}?done=synced&added=${outcome.added}`);
}

export async function showNewestAction(form: FormData) {
  const { subject, league } = await adminOfLeague();
  const on = text(form, "showNewest") === "on";
  await txDb.transaction((tx) =>
    setShowNewest(tx, { leagueId: league.id, on, actorId: subject.userId }),
  );
  refreshPhotoPages();
  redirect(`${PAGE}?done=${on ? "newest_on" : "newest_off"}`);
}

/** Feature, unfeature, hide or show one post. */
export async function togglePostAction(
  postId: string,
  kind: "feature" | "hide",
  on: boolean,
) {
  const { subject, league } = await adminOfLeague();
  const id = parseId<SocialPostId>(postId);
  if (!id) notFound();
  const result = await txDb.transaction((tx) =>
    curatePost(tx, {
      leagueId: league.id,
      postId: id,
      change: { kind, on },
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}#post-${id}`);
  refreshPhotoPages();
  redirect(`${PAGE}?done=saved#post-${id}`);
}

/** Saves a post's team, event, cover and alt text together, in that order. */
export async function savePostDetailsAction(postId: string, form: FormData) {
  const { subject, league } = await adminOfLeague();
  const id = parseId<SocialPostId>(postId);
  if (!id) notFound();
  const chosenTeam = text(form, "teamId");
  const teamId = chosenTeam ? parseId<TeamId>(chosenTeam) : null;
  if (chosenTeam && !teamId) redirect(`${PAGE}?error=unknown_team#post-${id}`);
  const chosenEvent = text(form, "eventId");
  const eventId = chosenEvent ? parseId<EventId>(chosenEvent) : null;
  if (chosenEvent && !eventId)
    redirect(`${PAGE}?error=unknown_event#post-${id}`);
  const cover = text(form, "cover");
  const changes: Curation[] = [
    { kind: "team", teamId },
    { kind: "event", eventId },
    {
      kind: "cover",
      cover: cover === "home" || cover === "team" ? cover : null,
    },
    { kind: "alt", text: text(form, "altText") },
  ];
  let error: string | null = null;
  try {
    await txDb.transaction(async (tx) => {
      for (const change of changes) {
        const result = await curatePost(tx, {
          leagueId: league.id,
          postId: id,
          change,
          actorId: subject.userId,
        });
        if (!result.ok) {
          error = result.error;
          // Undo the earlier changes in this save; Drizzle throws to do it.
          tx.rollback();
        }
      }
    });
  } catch (e) {
    if (!error) throw e;
  }
  if (error) redirect(`${PAGE}?error=${error}#post-${id}`);
  refreshPhotoPages();
  redirect(`${PAGE}?done=saved#post-${id}`);
}
