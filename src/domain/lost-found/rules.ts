import { err, ok, type Result } from "../result";

/**
 * The lost and found board (issue #385; docs/product-spec.md, section 9).
 * Members post what they found or lost; the owner of a found item (or the
 * finder of a lost one) answers it, and the two talk inside the app, never
 * seeing each other's contact details. These rules hold in the database
 * layer and are tested apart from it.
 */

export type ItemKind = "found" | "lost";

/**
 * open: on the board. returned: handed back to the person who answered
 * (the claim is "handed_over"). closed: the poster took it down. expired:
 * 30 days with no hand-over. removed: an admin took the post down.
 */
export type ItemStatus = "open" | "returned" | "closed" | "expired" | "removed";

/**
 * open: waiting for the poster. handed_over: the poster confirmed it.
 * withdrawn: the person who answered took it back. closed: the post closed
 * without this answer (returned to someone else, expired, closed, removed).
 */
export type ClaimStatus = "open" | "handed_over" | "withdrawn" | "closed";

/** Days an item stays on the board before the daily job closes it. */
export const ITEM_LIFE_DAYS = 30;
/** Days a closed post's row is kept (without its photo) before it is deleted. */
export const CLOSED_KEEP_DAYS = 90;
export const DESCRIPTION_MAX = 300;
export const PLACE_MAX = 80;
export const WHERE_NOW_MAX = 120;
export const MESSAGE_MAX = 500;
/** Open answers one item takes, so a post can't be buried in them. */
export const MAX_OPEN_CLAIMS = 5;
/** Posts one person may make in any 24 hours. */
export const DAILY_POSTS = 5;
/** The thumbnail's longest edge; the board is a list people scroll on phones. */
export const THUMB_LONG_EDGE = 320;

export const HOME_BAR = "The home bar";
export const ELSEWHERE = "Somewhere else";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PostProblem =
  | "no_description"
  | "description_too_long"
  | "no_place"
  | "place_too_long"
  | "where_now_needed"
  | "where_now_too_long"
  | "daily_posts";

export type PostFields = {
  kind: ItemKind;
  description: string;
  place: string;
  /** Where a found item is now; lost notes have none. */
  whereNow: string;
};

export type CleanPost = {
  kind: ItemKind;
  description: string;
  place: string;
  whereNow: string | null;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Checks and tidies the words of a post. */
export function cleanPost(f: PostFields): Result<CleanPost, PostProblem> {
  const description = squash(f.description);
  const place = squash(f.place);
  const whereNow = squash(f.whereNow);
  if (!description) return err("no_description");
  if (description.length > DESCRIPTION_MAX) return err("description_too_long");
  if (!place) return err("no_place");
  if (place.length > PLACE_MAX) return err("place_too_long");
  if (f.kind === "found") {
    if (!whereNow) return err("where_now_needed");
    if (whereNow.length > WHERE_NOW_MAX) return err("where_now_too_long");
  }
  return ok({
    kind: f.kind,
    description,
    place,
    whereNow: f.kind === "found" ? whereNow : null,
  });
}

/** Whether one more post stays within the person's daily limit. */
export const underDailyPostLimit = (postsInLastDay: number) =>
  postsInLastDay < DAILY_POSTS;

/** When an item posted at `postedAt` is closed by the daily job. */
export const expiresAt = (postedAt: Date) =>
  new Date(postedAt.getTime() + ITEM_LIFE_DAYS * DAY_MS);

/** Whole days left on the board, never below 0. */
export function daysLeft(postedAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.ceil((expiresAt(postedAt).getTime() - now.getTime()) / DAY_MS),
  );
}

export type ClaimProblem =
  "own_post" | "not_open" | "already_answered" | "too_many";

/**
 * Whether `responder` may answer `item`: not their own post, only while it
 * is open, once each, and while fewer than MAX_OPEN_CLAIMS answers wait.
 */
export function checkClaim(input: {
  posterId: string;
  responderId: string;
  status: ItemStatus;
  /** The responder's earlier answer to this item, if any. */
  earlier: ClaimStatus | null;
  openClaims: number;
}): Result<void, ClaimProblem> {
  if (input.posterId === input.responderId) return err("own_post");
  if (input.status !== "open") return err("not_open");
  // One answer each, whatever became of it: a withdrawn one is not redone.
  if (input.earlier !== null) return err("already_answered");
  if (input.openClaims >= MAX_OPEN_CLAIMS) return err("too_many");
  return ok(undefined);
}

export type MessageProblem = "empty" | "too_long";

export function cleanMessage(body: string): Result<string, MessageProblem> {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return err("empty");
  if (text.length > MESSAGE_MAX) return err("too_long");
  return ok(text);
}

/** What a member is told, in words they can act on. */
export const POST_MESSAGES: Readonly<Record<PostProblem, string>> = {
  no_description: "Say what it is, for example “black cleats, size 10”.",
  description_too_long: `Keep the description to ${DESCRIPTION_MAX} characters.`,
  no_place: "Say where it was found or lost.",
  place_too_long: `Keep the place to ${PLACE_MAX} characters.`,
  where_now_needed:
    "Say where the item is now, so its owner knows where to pick it up.",
  where_now_too_long: `Keep where it is now to ${WHERE_NOW_MAX} characters.`,
  daily_posts: `You've posted ${DAILY_POSTS} items in the last day, the most the board takes. Try again tomorrow.`,
};

export const CLAIM_MESSAGES: Readonly<Record<ClaimProblem, string>> = {
  own_post: "That's your own post. You can close it when it's sorted.",
  not_open: "This post is closed.",
  already_answered:
    "You already answered this post. Open it from your list to keep talking.",
  too_many:
    "This post already has several answers waiting. Try again once the poster has replied.",
};

export const MESSAGE_PROBLEMS: Readonly<Record<MessageProblem, string>> = {
  empty: "Write a message first.",
  too_long: `Keep it to ${MESSAGE_MAX} characters.`,
};

/** A first name only: the board never shows a full name or any contact detail. */
export function firstName(name: string): string {
  const first = squash(name).split(" ")[0];
  return first || "A member";
}
