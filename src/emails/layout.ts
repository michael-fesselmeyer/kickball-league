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
};

export type EmailParts = {
  subject: string;
  heading: string;
  /** Plain-text paragraphs; blank lines inside one are kept as line breaks. */
  paragraphs: readonly string[];
  action?: { label: string; path: string };
  /** Finishes "You got this email because …". */
  reason: string;
};

const muted = "font-size:14px;line-height:1.5;color:#5c5650";

export function renderEmail(
  { subject, heading, paragraphs, action, reason }: EmailParts,
  { siteUrl }: RenderContext,
) {
  const site = siteUrl.replace(/\/$/, "");
  const link = (path: string) => `${site}${path}`;
  const settings = link("/app/profile#notifications");
  const body = paragraphs
    .map(
      (p) =>
        `<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${escapeHtml(p).replaceAll("\n", "<br>")}</p>`,
    )
    .join("\n");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link(action.path))}" style="display:inline-block;padding:12px 20px;border-radius:999px;background-color:#1d1b18;color:#fdf6ec;font-weight:700;text-decoration:none">${escapeHtml(action.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background-color:#fdf6ec;font-family:Helvetica,Arial,sans-serif;color:#1d1b18">
<table role="presentation" width="100%" style="max-width:520px"><tbody><tr><td>
<h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${body}
${button}
<p style="${muted};margin-top:32px">You got this email because ${escapeHtml(reason)}. <a href="${escapeHtml(settings)}" style="color:#5c5650">Choose which emails you get</a>.</p>
</td></tr></tbody></table>
</body></html>`;
  const text = [
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(action ? [`${action.label}: ${link(action.path)}`, ""] : []),
    `You got this email because ${reason}.`,
    `Choose which emails you get: ${settings}`,
  ].join("\n");
  return {
    subject,
    html,
    text,
    push: pushFrom(
      action ? { heading, paragraphs, action } : { heading, paragraphs },
    ),
  };
}

/** The most a notification shows before the phone cuts it off. */
const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX = 180;

const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/**
 * The same message as a phone notification: the email's heading as the
 * title, its first paragraph as the text, and its button's page as where a
 * tap goes. No footer: the settings page is one tap from any notification.
 */
export function pushFrom({
  heading,
  paragraphs,
  action,
}: Pick<EmailParts, "heading" | "paragraphs" | "action">) {
  return {
    title: clip(heading, PUSH_TITLE_MAX),
    body: clip((paragraphs[0] ?? "").replaceAll("\n", " "), PUSH_BODY_MAX),
    path: action?.path ?? "/app",
  };
}
