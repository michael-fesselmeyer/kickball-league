import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { type Messages, messagesFor } from "@/i18n/messages";
import { linkIn } from "@/i18n/routing";

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
   * The recipient's language (ADR 0094), English unless given. Emails only
   * league admins get are always in English (src/emails/templates.ts).
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

/** The recipient's language, and the email words in it. */
export function emailWords(context: Pick<RenderContext, "locale">): {
  locale: Locale;
  w: Messages["email"];
} {
  const locale = context.locale ?? DEFAULT_LOCALE;
  return { locale, w: messagesFor(locale).email };
}

/**
 * A public page's path for the recipient: its page in their language when
 * that page is translated, else the English page. App paths stay as they
 * are; the app's screens follow the person's own setting.
 */
export function publicPath(context: RenderContext, path: string): string {
  return linkIn(context.locale ?? DEFAULT_LOCALE, path);
}

const muted = "font-size:14px;line-height:1.5;color:#5c5650";

export function renderEmail(
  {
    subject,
    heading,
    paragraphs,
    action,
    items = [],
    reason,
    settings: ownSettings,
  }: EmailParts,
  context: RenderContext,
) {
  const { siteUrl, unsubscribe } = context;
  const { locale, w } = emailWords(context);
  const words = w.layout;
  const settings = ownSettings ?? {
    label: words.settings,
    path: EMAIL_SETTINGS.path,
  };
  const because = fill(words.because, { reason });
  const stop = unsubscribe
    ? fill(words.stopAbout, {
        topic: unsubscribe.topicLabel.toLowerCase(),
      })
    : "";
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
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px;background-color:#fdf6ec;font-family:Helvetica,Arial,sans-serif;color:#1d1b18">
<table role="presentation" width="100%" style="max-width:520px"><tbody><tr><td>
<h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${body}
${list}
${button}
<p style="${muted};margin-top:32px">${escapeHtml(because)} <a href="${escapeHtml(settingsUrl)}" style="color:#5c5650">${escapeHtml(settings.label)}</a>.${unsubscribe ? ` <a href="${escapeHtml(unsubscribe.pageUrl)}" style="color:#5c5650">${escapeHtml(stop)}</a>.` : ""}</p>
${unsubscribe ? `<p style="${muted}">${escapeHtml(words.fewer)} ${TURN_DOWN_LINKS.map((t) => `<a href="${escapeHtml(turnDownUrl(unsubscribe.pageUrl, t.choice))}" style="color:#5c5650">${escapeHtml(words.turnDown[t.choice])}</a>`).join(" · ")}</p>` : ""}
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
    because,
    `${settings.label}: ${settingsUrl}`,
    ...(unsubscribe
      ? [
          `${stop}: ${unsubscribe.pageUrl}`,
          ...TURN_DOWN_LINKS.map(
            (t) =>
              `${words.turnDown[t.choice]}: ${turnDownUrl(unsubscribe.pageUrl, t.choice)}`,
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
      locale,
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
export function pushFrom(
  {
    heading,
    paragraphs,
    action,
    reason,
  }: Pick<EmailParts, "heading" | "paragraphs" | "action" | "reason">,
  locale: Locale = DEFAULT_LOCALE,
) {
  return {
    title: clip(heading, PUSH_TITLE_MAX),
    body: clip((paragraphs[0] ?? "").replaceAll("\n", " "), PUSH_BODY_MAX),
    path: action?.path ?? "/app",
    reason: clip(
      fill(messagesFor(locale).email.layout.pushBecause, { reason }),
      PUSH_REASON_MAX,
    ),
  };
}
