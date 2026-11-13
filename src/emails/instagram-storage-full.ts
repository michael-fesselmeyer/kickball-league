import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** Tells an admin the Instagram photo storage reached its cap (ADR 0023). */
export const instagramStorageFullPayload = z.object({
  capMegabytes: z.number().int().positive(),
});

export type InstagramStorageFullPayload = z.infer<
  typeof instagramStorageFullPayload
>;

export const instagramStorageFullEmail = defineTemplate(
  instagramStorageFullPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: "Instagram photo storage is full",
        heading: "New Instagram posts aren't being copied",
        paragraphs: [
          `The site keeps up to ${p.capMegabytes} MB of Instagram photos so it stays on the free database plan, and that is now used up. Photos already on the site stay up.`,
          "Featured photos and covers are always kept, so unfeature or hide older ones you no longer need, and the next sync copies the newest posts.",
        ],
        action: {
          label: "Open Instagram photos",
          path: "/app/admin/instagram",
        },
        reason: "you are a league admin",
      },
      ctx,
    ),
);
