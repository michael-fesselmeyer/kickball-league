import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** One held message, as the digest job read it from its own template. */
const digestItem = z.object({
  title: z.string().min(1),
  text: z.string(),
  path: z.string().startsWith("/"),
});

export const digestPayload = z.object({
  frequency: z.enum(["daily", "weekly"]),
  /** The person's daily cap when the digest was built. */
  dailyCap: z.number().int().min(0),
  items: z.array(digestItem).min(1),
});

export type DigestPayload = z.infer<typeof digestPayload>;

/** Where the cap, digest and quiet hours are set on the profile page. */
export const ALERT_LIMITS_PATH = "/app/profile#alert-limits";

/**
 * The digest: the non-urgent messages a person's daily cap held back,
 * together in one email, each linking to its page.
 */
export const digestEmail = defineTemplate(digestPayload, (p, ctx) => {
  const count = p.items.length;
  const what = count === 1 ? "1 update" : `${count} updates`;
  const when = p.frequency === "daily" ? "today" : "this week";
  return renderEmail(
    {
      subject: `League news: ${what}`,
      heading: `Your league news ${when}`,
      paragraphs: [
        `Here ${count === 1 ? "is the update" : `are the ${count} updates`} we held back so your inbox stays calm.`,
      ],
      items: p.items,
      reason:
        p.dailyCap === 0
          ? `you chose to get news that can wait in one ${p.frequency} email`
          : `you get at most ${p.dailyCap} league ${p.dailyCap === 1 ? "email" : "emails"} a day that can wait, and these came after that`,
      settings: {
        label: "Change your daily limit, digest or quiet hours",
        path: ALERT_LIMITS_PATH,
      },
    },
    ctx,
  );
});
