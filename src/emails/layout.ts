import type { Locale } from "@/i18n/locales";

/**
 * The frame every league email shares: a heading, the body, an optional
 * button, and a footer that says why the person got it and where to change
 * that. Built as escaped strings, like the sign-in email, with inline styles
 * because email clients drop stylesheets.
 */
export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export type RenderContext = {
  /** The site's address, such as https://league.example.test, for links. */
  siteUrl: string;
  /**
   * The recipient's language (ADR 0065). Templates write in it as they are
   * translated; until then they stay in English.
   */
  locale?: Locale;
  /**
   * The recipient's one-click unsubscribe for this email's topic, when they
   * can turn it off (src/lib/unsubscribe.ts): absolute URLs.
   */
  unsubscribe?: { pageUrl: string; oneClickUrl: string; topicLabel: string };
};

export type EmailParts = {
  subject: string;
  heading: string;
  /** Plain-text paragraphs; blank lines inside one are kept as line breaks. */
  paragraphs: readonly string[];
  action?: { label: string; path: string };
  /** Linked entries after the paragraphs, as the digest lists its news. */
  items?: readonly { title: string; text: string; path: string }[];
  /** Finishes "You got this email because …". */
  reason: string;
  /** The setting that changes it; the email settings by default. */
  settings?: { label: string; path: string };
};

/**
 * Ways to turn emails down instead of off (issue #529), next to the
 * unsubscribe link. Each opens the unsubscribe page with that choice ready;
 * only its button changes anything.
 */
export const TURN_DOWN_LINKS = [
  { choice: "team", label: "Only my team" },
  { choice: "weekly", label: "Weekly digest instead" },
  { choice: "snooze", label: "Snooze for 2 weeks" },
] as const;

const turnDownUrl = (pageUrl: string, choice: string) =>
  `${pageUrl}?do=${choice}`;

/** Where every email's footer points unless it names its own setting. */
export const EMAIL_SETTINGS = {
  label: "Choose which emails you get and when",
  path: "/app/profile#notifications",
};

const muted = "font-size:14px;line-height:1.5;color:#5c5650";

export function renderEmail(
  {
    subject,
    heading,
    paragraphs,
    action,
    items = [],
    reason,
    settings = EMAIL_SETTINGS,
  }: EmailParts,
  { siteUrl, unsubscribe }: RenderContext,
) {
  const site = siteUrl.replace(/\/$/, "");
  const link = (path: string) => `${site}${path}`;
  const settingsUrl = link(settings.path);
  const body = paragraphs
    .map(
      (p) =>
        `<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(p).replaceAll("\n", "<br>")}</p>`,
    )
    .join("\n");
  const list =
    items.length > 0
      ? `<ul style="padding:0 0 0 20px;margin:0 0 16px">${items
          .map(
            (i) =>
              `<li style="font-size:16px;line-height:1.5;margin:0 0 12px"><a href="${escapeHtml(link(i.path))}" style="color:#1d1b18;font-weight:700">${escapeHtml(i.title)}</a>${i.text ? `<br>${escapeHtml(i.text)}` : ""}</li>`,
          )
          .join("\n")}</ul>`
      : "";
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link(action.path))}" style="display:inline-block;padding:12px 20px;border-radius:999px;background-color:#1d1b18;color:#fdf6ec;font-weight:700;text-decoration:none">${escapeHtml(action.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background-color:#fdf6ec;font-family:Helvetica,Arial,sans-serif;color:#1d1b18">
<table role="presentation" width="100%" style="max-width:520px"><tbody><tr><td>
<h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${body}
${list}
${button}
<p style="${muted};margin-top:32px">You got this email because ${escapeHtml(reason)}. <a href="${escapeHtml(settingsUrl)}" style="color:#5c5650">${escapeHtml(settings.label)}</a>.${unsubscribe ? ` <a href="${escapeHtml(unsubscribe.pageUrl)}" style="color:#5c5650">Stop emails about ${escapeHtml(unsubscribe.topicLabel.toLowerCase())}</a>.` : ""}</p>
${unsubscribe ? `<p style="${muted}">Fewer emails instead? ${TURN_DOWN_LINKS.map((t) => `<a href="${escapeHtml(turnDownUrl(unsubscribe.pageUrl, t.choice))}" style="color:#5c5650">${t.label}</a>`).join(" · ")}</p>` : ""}
</td></tr></tbody></table>
</body></html>`;
  const text = [
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...items.flatMap((i) => [
      `- ${i.title}`,
      ...(i.text ? [`  ${i.text}`] : []),
      `  ${link(i.path)}`,
      "",
    ]),
    ...(action ? [`${action.label}: ${link(action.path)}`, ""] : []),
    `You got this email because ${reason}.`,
    `${settings.label}: ${settingsUrl}`,
    ...(unsubscribe
      ? [
          `Stop emails about ${unsubscribe.topicLabel.toLowerCase()}: ${unsubscribe.pageUrl}`,
          ...TURN_DOWN_LINKS.map(
            (t) => `${t.label}: ${turnDownUrl(unsubscribe.pageUrl, t.choice)}`,
          ),
        ]
      : []),
  ].join("\n");
  return {
    subject,
    html,
    text,
    ...(unsubscribe ? { listUnsubscribe: unsubscribe.oneClickUrl } : {}),
    push: pushFrom(
      action
        ? { heading, paragraphs, action, reason }
        : { heading, paragraphs, reason },
    ),
  };
}

/** The most a notification shows before the phone cuts it off. */
const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX = 180;

const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

const PUSH_REASON_MAX = 100;

/**
 * The same message as a phone notification: the email's heading as the
 * title, its first paragraph as the text, its button's page as where a tap
 * goes, and the email's reason as a "Because …" line under the text. The
 * service worker adds a button to the push settings (public/sw.js).
 */
export function pushFrom({
  heading,
  paragraphs,
  action,
  reason,
}: Pick<EmailParts, "heading" | "paragraphs" | "action" | "reason">) {
  return {
    title: clip(heading, PUSH_TITLE_MAX),
    body: clip((paragraphs[0] ?? "").replaceAll("\n", " "), PUSH_BODY_MAX),
    path: action?.path ?? "/app",
    reason: clip(`Because ${reason}.`, PUSH_REASON_MAX),
  };
}
