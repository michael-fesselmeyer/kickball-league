import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/** Tells an admin the Instagram connection stopped and needs signing in again. */
export const instagramReconnectPayload = z.object({
  username: z.string().min(1),
  reason: z.string().min(1),
});

export type InstagramReconnectPayload = z.infer<
  typeof instagramReconnectPayload
>;

export const instagramReconnectEmail = defineTemplate(
  instagramReconnectPayload,
  (p, ctx) =>
    renderEmail(
      {
        subject: `Reconnect Instagram (@${p.username})`,
        heading: "Instagram needs you to sign in again",
        paragraphs: [
          `${p.reason}, so new posts from @${p.username} have stopped syncing. The photos already on the site stay up.`,
          "Connecting again takes a minute: sign in on Instagram's own screen and the sync picks up where it left off.",
        ],
        action: { label: "Reconnect Instagram", path: "/app/admin/instagram" },
        reason: "you are a league admin",
      },
      ctx,
    ),
);
