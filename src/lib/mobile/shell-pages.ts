import { light } from "@/design/tokens";
import type { AppUrl } from "./app-url";

/**
 * The two pages the iOS and Android shells carry themselves (webDir in
 * capacitor.config.ts). The shell opens the site straight away, so people
 * see these only when the site can't be reached: index.html is the shell's
 * required start page and sends the person on to the site, and
 * offline.html is the shell's error page. Both are written by
 * `npm run mobile:web` with the site's address from MOBILE_APP_URL.
 *
 * The site's own offline page and saved next game (the service worker,
 * docs/architecture.md section 14) cover a lost signal once the site has
 * loaded; this page covers an app opened with no signal before the worker
 * has ever run, or a site that is down.
 */

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom));
    box-sizing: border-box;
    background: ${light.bg};
    color: ${light.text};
    font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    text-align: center;
  }
  h1 { font-size: 1.5rem; margin: 0; }
  p { margin: 0; max-width: 22rem; color: ${light["text-muted"]}; }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 1.25rem;
    border: 2px solid ${light.text};
    border-radius: 0.75rem;
    background: ${light.brand};
    color: ${light["on-brand"]};
    font-weight: 700;
    text-decoration: none;
  }
  a:focus-visible { outline: 3px solid ${light.focus}; outline-offset: 2px; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function shellPages(app: AppUrl): Record<string, string> {
  const home = escapeHtml(`${app.origin}/app`);
  return {
    "index.html": page(
      "Kickball",
      `<h1>Opening the league…</h1>
<p><a href="${home}">Open the league</a></p>
<script>location.replace(${JSON.stringify(`${app.origin}/app`)});</script>`,
    ),
    "offline.html": page(
      "Can't reach the league",
      `<h1>Can't reach the league</h1>
<p>Check your signal and try again. Once the app has opened with a signal, your next game stays on this phone for times like this.</p>
<a href="${home}">Try again</a>`,
    ),
  };
}
