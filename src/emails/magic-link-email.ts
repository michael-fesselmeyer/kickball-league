/**
 * The sign-in email, as HTML and plain text. Built as a string with every
 * value escaped: Next.js keeps react-dom/server out of server components,
 * and this page has one link and three sentences. Inline styles only,
 * because email clients drop stylesheets.
 */
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The code goes first, in the subject too, so a phone can offer it from a
 * notification and iOS can fill it into the code field from Mail (ADR
 * 0077). The link still works on its own.
 */
export function renderMagicLinkEmail({
  url,
  code,
  minutes,
}: {
  url: string;
  code: string;
  minutes: number;
}) {
  const href = escape(url);
  const digits = escape(code);
  const muted = "font-size:14px;line-height:1.5;color:#5c5650";
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background-color:#fdf6ec;font-family:Helvetica,Arial,sans-serif;color:#1d1b18">
<table role="presentation" width="100%" style="max-width:480px"><tbody><tr><td>
<h1 style="font-size:24px;margin:0 0 16px">Sign in to the league</h1>
<p style="font-size:16px;line-height:1.5">Tap the button to sign in, or enter this code where you asked for it, such as in the app. Either works once and expires in ${minutes} minutes.</p>
<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace">${digits}</p>
<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:999px;background-color:#1d1b18;color:#fdf6ec;font-weight:700;text-decoration:none">Sign in</a></p>
<p style="${muted}">If the button does not work, paste this into your browser:<br>${href}</p>
<p style="${muted}">Did not ask to sign in? Ignore this email; nothing changes.</p>
</td></tr></tbody></table>
</body></html>`;
  const text = [
    "Sign in to the league",
    "",
    `Your sign-in code is ${code}. Enter it where you asked for it, such as in the app, or open this link. Either works once and expires in ${minutes} minutes:`,
    url,
    "",
    "Did not ask to sign in? Ignore this email; nothing changes.",
  ].join("\n");
  return { subject: `${code} is your sign-in code`, html, text };
}
