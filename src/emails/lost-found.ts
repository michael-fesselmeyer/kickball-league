import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Notices from the lost and found board (issue #385). They carry a first
 * name and the item's short description, never an address or a phone number:
 * the two people talk inside the app.
 */

/** Someone answered a post, or wrote in a thread: a person waiting on you. */
export const lostFoundReplyPayload = z.object({
  kind: z.enum(["claim", "reply"]),
  /** Whether the post is a found item or a lost note. */
  postKind: z.enum(["found", "lost"]),
  /** The other person's first name. */
  from: z.string().min(1),
  /** What the post is about, as its poster described it. */
  item: z.string().min(1),
  /** The thread, or the post. */
  path: z.string().startsWith("/"),
});

export type LostFoundReplyPayload = z.infer<typeof lostFoundReplyPayload>;

export const lostFoundReplyEmail = defineTemplate(
  lostFoundReplyPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject:
          p.kind === "claim"
            ? p.postKind === "found"
              ? `${p.from} says it's theirs: ${p.item}`
              : `${p.from} may have found: ${p.item}`
            : `${p.from} wrote to you about: ${p.item}`,
        heading:
          p.kind === "claim"
            ? p.postKind === "found"
              ? `${p.from} says it's theirs`
              : `${p.from} says they found it`
            : `A message from ${p.from}`,
        paragraphs: [
          p.kind === "claim"
            ? `${p.from} answered your post on the lost and found board: “${p.item}”.`
            : `${p.from} wrote to you about “${p.item}” on the lost and found board.`,
          "Read it and reply in the app. Nobody's phone number or email is shared; you arrange the hand-over there.",
        ],
        action: { label: "Open the conversation", path: p.path },
        reason: "you posted on, or answered, the lost and found board",
      },
      ctx,
    ),
);

/** A post closed: handed over, expired, taken down or removed. */
export const lostFoundUpdatePayload = z.object({
  kind: z.enum([
    /** To the poster: their post closed after 30 days. */
    "expired",
    /** To the poster: an admin took it down. */
    "removed",
    /** To someone who answered: the post is closed, not given to them. */
    "answer_closed",
    /** To the person it was handed to. */
    "handed_over",
  ]),
  postKind: z.enum(["found", "lost"]),
  item: z.string().min(1),
  path: z.string().startsWith("/"),
});

export type LostFoundUpdatePayload = z.infer<typeof lostFoundUpdatePayload>;

const UPDATE_TEXT: Record<
  LostFoundUpdatePayload["kind"],
  (item: string) => { subject: string; heading: string; body: string[] }
> = {
  expired: (item) => ({
    subject: "Your lost and found post closed",
    heading: "Your post closed after 30 days",
    body: [
      `“${item}” was on the lost and found board for 30 days, so it has closed and its photo is gone.`,
      "If it's still unclaimed, you can post it again, or hand it to the league's admins.",
    ],
  }),
  removed: (item) => ({
    subject: "Your lost and found post was taken down",
    heading: "An admin took your post down",
    body: [
      `The league's admins took down your post “${item}” from the lost and found board.`,
      "If you think that was a mistake, write to the league.",
    ],
  }),
  answer_closed: (item) => ({
    subject: "That lost and found post is closed",
    heading: "That post is closed",
    body: [
      `The post “${item}” is closed, so your conversation about it has ended.`,
      "It may have gone to someone else, or been taken down.",
    ],
  }),
  handed_over: (item) => ({
    subject: "Your hand-over is confirmed",
    heading: "Marked as handed over",
    body: [
      `The poster marked “${item}” as handed over to you. The post is now closed.`,
    ],
  }),
};

export const lostFoundUpdateEmail = defineTemplate(
  lostFoundUpdatePayload,
  (p, ctx) => {
    const t = UPDATE_TEXT[p.kind](p.item);
    return renderEmail(
      {
        subject: t.subject,
        heading: t.heading,
        paragraphs: t.body,
        action: { label: "Lost and found", path: p.path },
        reason: "you posted on, or answered, the lost and found board",
      },
      ctx,
    );
  },
);
