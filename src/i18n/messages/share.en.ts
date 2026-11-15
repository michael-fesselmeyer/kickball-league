/**
 * The share buttons' words (`en.share`). Its own module for the same reason
 * as live.en.ts: the buttons are a client component.
 */
export const shareEn = {
  whatsapp: "Share on WhatsApp",
  opensWhatsapp: " (opens WhatsApp)",
  more: "More ways to share",
  copy: "Copy the message",
  copied: "Copied. Paste it into any chat.",
  manual: "Copying didn't work here. Select the message and copy it:",
} as const;

export type ShareWords = { readonly [K in keyof typeof shareEn]: string };
