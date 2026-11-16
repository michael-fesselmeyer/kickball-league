# ADR 0090: iOS and Android apps as a native shell around the site, built locally

- Status: accepted
- Date: 2026-11-15

## Context

Players mostly use the league on phones at the field. The site is already an installable web app ([architecture, section 14](../architecture.md#14-mobile-app-pwa-first)): the next game opens with no signal, scores entered offline are sent later, and web push covers rain-outs and sub requests. Some players still look for the league in their phone's app list rather than "Add to Home Screen", and an app has a few things a home-screen web app lacks: Android's back button behaving like an app's, outside links opening in the system browser, and room for native push later.

Limits that shape the choice:

- **Free only** ([ADR 0021](0021-free-services-only.md)). The App Store needs a $99 a year developer account and Google Play a $25 one-time fee, so neither is approved. The apps are built and run locally: in the iOS Simulator and Android emulator, on an Android phone with a debug build, or on an iPhone through Xcode's free personal team (an install that lasts 7 days).
- **One product.** Every screen is a Next.js server-rendered page or Server Action against Postgres. There is no client-side app to bundle without rewriting the site.
- **Fast on phones.** The site's budgets ([design system, Performance budgets](../design-system.md)) must not move for people who never install the app.

## Decision

**Each app is a Capacitor 8 shell whose web view opens the site itself.** `capacitor.config.ts` sets `server.url` to the site's origin; the shell carries only two pages of its own, a start page and an error page (`src/lib/mobile/shell-pages.ts`). There is one copy of every screen, every fix reaches the apps without a new build, and the apps cost nothing to run.

**The address is a setting, never code.** `MOBILE_APP_URL` (in `.env.local` or the shell's environment) is read when the native projects are synced (`npm run mobile:sync`) and checked by `resolveAppUrl` (`src/lib/mobile/app-url.ts`): https for anything real, plain http only for a dev server on `localhost`. The iOS Simulator shares the laptop's `localhost`, and an Android emulator reaches it through `adb reverse`, so one address serves both, and `localhost` counts as a secure context, so the service worker runs. A production build of the apps is the same command with the production address.

**No new JavaScript on the site.** The site never imports Capacitor. The shell puts a `Capacitor` object on every page before the site's scripts run, and a small inline script in the root layout (`nativeShellScript`, `src/lib/mobile/native-shell.ts`) returns at once without it. Inside the apps it:

- marks `<html data-shell="app">`, which the install offer and push settings read;
- opens links to other sites in the system browser (the Browser plugin), leaving this site's links, `mailto:` and `tel:` alone;
- makes Android's back button close an open dialog first, then go back a page, and at the first page put the app in the background;
- follows a link to this site that opened the app (`appUrlOpen`) to its page, ready for Android App Links.

The plugins are reached through `Capacitor.Plugins`, so the site needs no package for them, and a shell built without one falls back to the web view's own behavior.

**Safe areas.** The root layout asks for `viewport-fit=cover`, and the layout pads itself with the safe-area insets: the header strip under the status bar, the footer above the home indicator, and the sides in landscape (`pt-safe`, `pb-safe`, `px-safe` in `globals.css`). Capacitor's SystemBars plugin passes Android's insets as `--safe-area-inset-*` because older Android web views report `env()` as 0; elsewhere `env()` has them, and in a browser they are 0 wherever nothing is in the way.

**Offline.** Android's web view runs the site's service worker as Chrome does. WKWebView runs one only on an app-bound domain, so the iOS shell sets `limitsNavigationsToAppBoundDomains` and `npm run mobile:sync` writes the site's host into `WKAppBoundDomains` (`scripts/mobile-ios-domains.ts`). The next game, the score outbox and the offline page then work in the apps as they do in the browser. An app opened with no signal before the site has ever loaded shows the shell's own "Can't reach the league" page, with a button to try again.

**Push.** Web push does not exist in either platform's web view, and native push needs Firebase Cloud Messaging (free) on Android and the Apple Push Notification service on iOS, which needs the paid developer account. For now the apps don't offer push: the profile page says so and points to the browser, where web push keeps working (on iPhone, from the site added to the Home Screen), and email covers everything as before. Native Android push through FCM is a later, free addition.

**Icons and splash.** The league's logo stays out of the repository until the league publishes it, so the apps use the same placeholder pennant as the web app's icons. `npm run mobile:assets` draws the sources (`mobile/assets/`) from `renderMark` in `src/lib/pwa/icons.tsx` with the design tokens, light and dark, and the Capacitor assets tool cuts every platform size from them. Android's adaptive foreground keeps the pennant inside the smallest crop circle (a unit test checks the geometry).

**Deep links.** iOS universal links need the Associated Domains capability, which the free personal team doesn't have. Android App Links are free but need the signing key's fingerprint served from `/.well-known/assetlinks.json`, and a debug key differs per laptop. Neither is set up yet; links in email and push open the browser, as today. The `appUrlOpen` handler is in place for when App Links are.

## Consequences

- **Sign-in inside the apps is the main gap.** Google refuses sign-in inside an embedded web view, a magic link opens in the phone's browser rather than the app, and passkeys in a web view need Associated Domains (iOS) or extra web view setup (Android). Until the site offers a sign-in code that can be typed into the app, the apps show the public pages and signed-in screens need the browser or the installed web app. This is tracked in issue #524, since resolved by [ADR 0077](0077-signing-in-inside-the-apps.md).
- Payments go through Stripe Checkout, which is another site, so checkout opens in the system browser and the purchase shows as paid in the app once Stripe's webhook arrives. This keeps card entry out of a web view, which is where it should be.
- Capacitor documents `server.url` as meant for live reload. For local builds it is the point; a store release would need its own review of Apple's minimum-functionality guideline and is not planned.
- The apps load the site over the network, so they are exactly as fast as the site on that phone, and the site's budgets apply to them unchanged. The inline script adds about 1 kB of HTML to each page and does nothing in a browser.
- The native projects (`ios/`, `android/`) are generated with `npm run mobile:add:ios` and `npm run mobile:add:android` once Xcode and Android Studio are installed ([docs/mobile.md](../mobile.md)), and committed then.

## Alternatives considered

- **Keep the PWA alone.** It already covers offline and push where the platform allows. It does not give a back button, an app-list entry, or a path to native push.
- **Bundle the pages into the app (static export).** Server Actions, sessions and every signed-in page need the server, so a bundled app would still call the site for everything and would need a rebuild for every change.
- **React Native with Expo.** A second codebase for every screen, which section 14 already ruled out, and its store builds need the same paid accounts.
- **A Trusted Web Activity on Android.** Free and close to the PWA, but Android only, and it needs the same `assetlinks.json` verification to hide the address bar.
