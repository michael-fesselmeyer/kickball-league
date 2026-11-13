import {
  applySync,
  type ConnectedAccount,
  connectedAccounts,
  postsToCopy,
  recordProblem,
  saveRefreshedToken,
  storedPosts,
  type SyncResult,
} from "@/db/queries/social";
import type { Db } from "@/db/queries/schedule";
import { compressPhoto } from "./compress-photo";
import {
  type DownloadedImage,
  downloadImage,
  type InstagramApp,
  recentPosts,
  refreshToken,
} from "@/services/instagram";

/**
 * The Instagram jobs' work (docs/architecture.md, section 17). Instagram is
 * called outside any transaction, so a slow answer never holds one open;
 * each account's result is then written in one transaction.
 */

type App = Pick<InstagramApp, "fetch" | "timeoutMs">;

export type AccountOutcome =
  ({ accountId: string } & SyncResult) | { accountId: string; error: string };

/**
 * Photos copied at once; Instagram's CDN is fast but a page holds 25. Each
 * is downloaded, then shrunk (./compress-photo.ts) before it is stored.
 */
const PARALLEL_COPIES = 4;

async function copyAll(
  app: App,
  posts: readonly { externalId: string; imageUrl: string }[],
): Promise<Map<string, DownloadedImage>> {
  const images = new Map<string, DownloadedImage>();
  for (let i = 0; i < posts.length; i += PARALLEL_COPIES) {
    const batch = posts.slice(i, i + PARALLEL_COPIES);
    const copied = await Promise.all(
      batch.map(async (p) => {
        const result = await downloadImage(app, p.imageUrl);
        // One small WebP copy is stored, never the original.
        return result.ok ? compressPhoto(result.value.bytes) : null;
      }),
    );
    copied.forEach((stored, j) => {
      if (stored) images.set(batch[j]!.externalId, stored);
    });
  }
  return images;
}

export async function syncAccount(
  db: Db,
  app: App,
  account: ConnectedAccount,
  now: Date,
): Promise<AccountOutcome> {
  const fetched = await recentPosts(app, account.token);
  if (!fetched.ok) {
    await recordProblem(db, account.id, fetched.error, now);
    return { accountId: account.id, error: fetched.error.message };
  }
  const stored = await storedPosts(db, account.id);
  const images = await copyAll(app, postsToCopy(stored, fetched.value));
  const result = await db.transaction((tx) =>
    applySync(tx, {
      accountId: account.id,
      fetched: fetched.value,
      images,
      now,
    }),
  );
  return { accountId: account.id, ...result };
}

/** Syncs every connected account. */
export async function syncAll(
  db: Db,
  app: App,
  secret: string,
  now: Date,
): Promise<AccountOutcome[]> {
  const accounts = await connectedAccounts(db, secret, now);
  const outcomes: AccountOutcome[] = [];
  for (const account of accounts)
    outcomes.push(await syncAccount(db, app, account, now));
  return outcomes;
}

/** Instagram refreshes only tokens at least a day old. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Extends every connected account's token; a refused one needs reconnecting. */
export async function refreshAll(
  db: Db,
  app: App,
  secret: string,
  now: Date,
): Promise<{ accountId: string; refreshed: boolean; error?: string }[]> {
  const accounts = await connectedAccounts(db, secret, now);
  const outcomes = [];
  for (const account of accounts) {
    if (
      account.tokenRefreshedAt &&
      now.getTime() - account.tokenRefreshedAt.getTime() < DAY_MS
    ) {
      outcomes.push({ accountId: account.id, refreshed: false });
      continue;
    }
    const result = await refreshToken(app, account.token, now);
    if (result.ok) {
      await saveRefreshedToken(db, {
        accountId: account.id,
        token: result.value,
        secret,
        now,
      });
      outcomes.push({ accountId: account.id, refreshed: true });
    } else {
      await recordProblem(db, account.id, result.error, now);
      outcomes.push({
        accountId: account.id,
        refreshed: false,
        error: result.error.message,
      });
    }
  }
  return outcomes;
}
