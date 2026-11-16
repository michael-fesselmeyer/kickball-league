/**
 * The iOS and Android shells (docs/mobile.md, ADR 0074). Each app is a
 * native web view that opens the league's site, so there is no second copy
 * of the pages to build or keep in step. The site's address comes from
 * MOBILE_APP_URL (in .env.local or the shell's environment) when
 * `npm run mobile:sync` copies this config into the native projects.
 *
 * Typed by hand rather than with the CLI's own type, so the project still
 * type-checks before the shell's packages are installed.
 */
import { loadEnvConfig } from "@next/env";
import { APP_URL_VARIABLE, resolveAppUrl } from "./src/lib/mobile/app-url";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
  info: () => {},
  error: console.error,
});

const app = resolveAppUrl(process.env[APP_URL_VARIABLE]);

/** The light theme's page background (src/design/tokens.ts). */
const BACKGROUND = "#FBF8F1";

const config = {
  // A placeholder in a reserved domain; set MOBILE_APP_ID to the league's
  // own reverse domain before any build leaves this machine.
  appId: process.env.MOBILE_APP_ID?.trim() || "com.example.kickball",
  appName: "Kickball",
  // The shell's own pages: a holding page and the page shown when the site
  // can't be reached. scripts/mobile-web.ts writes them.
  webDir: "mobile/www",
  backgroundColor: BACKGROUND,
  loggingBehavior: "debug",
  server: {
    url: app.origin,
    cleartext: app.cleartext,
    errorPath: "offline.html",
  },
  ios: {
    // WKWebView runs the site's service worker only on an app-bound domain
    // (Info.plist WKAppBoundDomains, set as docs/mobile.md describes).
    limitsNavigationsToAppBoundDomains: true,
    contentInset: "never",
    backgroundColor: BACKGROUND,
  },
  android: {
    backgroundColor: BACKGROUND,
    allowMixedContent: false,
  },
  plugins: {
    // Draw edge to edge and hand the page its safe-area insets as
    // --safe-area-inset-* variables, which src/app/globals.css reads.
    SystemBars: { insetsHandling: "css", style: "DEFAULT" },
  },
} as const;

export default config;
