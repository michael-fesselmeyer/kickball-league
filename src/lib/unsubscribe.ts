import { createHmac, timingSafeEqual } from "node:crypto";
import { parseId, type UserId } from "@/domain/ids";
import { SETTINGS_TOPICS, type Topic } from "@/domain/notifications/topics";

/**
 * One-click unsubscribe links (docs/product-spec.md, section 9: "Every email
 * has a one-click unsubscribe for its topic"). Mail apps and readers can't
 * sign in, so the link itself is the key, as with the private events feed
 * (src/lib/event-feed.ts): the person's id, the topic, and a signature of
 * both made with the server's secret. Nothing is stored, and only the topics
 * the settings page offers get a link: a suspension notice or the digest
 * must still arrive.
 */

const SIGNATURE_LENGTH = 32;

const OFFERED: ReadonlySet<string> = new Set(
  SETTINGS_TOPICS.map((t) => t.topic),
);

function signature(secret: string, userId: UserId, topic: Topic): string {
  return createHmac("sha256", secret)
    .update(`unsubscribe:${userId}:${topic}`)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
}

/** The token in an email's unsubscribe link, or null for a topic nobody can turn off. */
export function unsubscribeToken(
  secret: string,
  userId: UserId,
  topic: Topic,
): string | null {
  if (!OFFERED.has(topic)) return null;
  return `${userId.replaceAll("-", "")}.${topic}.${signature(secret, userId, topic)}`;
}

/** Whose email topic a token stands for, when its signature is right. */
export function readUnsubscribeToken(
  secret: string,
  token: string,
): { userId: UserId; topic: Topic } | null {
  const [hex, topic, given] = token.split(".");
  if (!hex || !topic || !given || !/^[0-9a-f]{32}$/.test(hex)) return null;
  if (!OFFERED.has(topic)) return null;
  const userId = parseId<UserId>(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
  if (!userId) return null;
  const expected = Buffer.from(signature(secret, userId, topic as Topic));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? { userId, topic: topic as Topic }
    : null;
}

/** The page an email's footer links to: it asks before turning anything off. */
export const unsubscribePagePath = (token: string) => `/unsubscribe/${token}`;

/**
 * Where a mail app's own unsubscribe button posts (RFC 8058, one-click):
 * a POST turns the topic off at once, a GET changes nothing.
 */
export const unsubscribePostPath = (token: string) =>
  `/api/unsubscribe/${token}`;

/** What the settings page calls a topic, for the footer and the page. */
export function topicLabel(topic: Topic): string {
  return SETTINGS_TOPICS.find((t) => t.topic === topic)?.label ?? topic;
}
