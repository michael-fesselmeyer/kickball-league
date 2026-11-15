import { z } from "zod";
import { fill, plural } from "@/i18n/catalog";
import { defineTemplate } from "./define";
import { emailWords, renderEmail } from "./layout";

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
  const { locale, w: all } = emailWords(ctx);
  const w = all.digest;
  const count = p.items.length;
  return renderEmail(
    {
      subject: fill(w.subject, {
        updates: plural(locale, w.updates, count),
      }),
      heading: p.frequency === "daily" ? w.headingDaily : w.headingWeekly,
      paragraphs: [plural(locale, w.lead, count)],
      items: p.items,
      reason:
        p.dailyCap === 0
          ? p.frequency === "daily"
            ? w.reasonDaily
            : w.reasonWeekly
          : plural(locale, w.reasonCap, p.dailyCap),
      settings: { label: w.settings, path: ALERT_LIMITS_PATH },
    },
    ctx,
  );
});
