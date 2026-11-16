/**
 * Sets WKAppBoundDomains in the iOS app's Info.plist to the site at
 * MOBILE_APP_URL plus the shell's own localhost (appBoundDomains in
 * src/lib/mobile/app-url.ts). WKWebView runs a site's service worker only
 * on an app-bound domain, and the offline game page and score outbox need
 * it. Run by `npm run mobile:sync` after Capacitor copies the config; does
 * nothing until `npm run mobile:add:ios` has made the iOS project. macOS
 * only (PlistBuddy ships with it).
 *
 *   npm run mobile:ios-domains
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  APP_URL_VARIABLE,
  appBoundDomains,
  resolveAppUrl,
} from "../src/lib/mobile/app-url";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const plist = join("ios", "App", "App", "Info.plist");
if (!existsSync(plist)) {
  console.log(`No ${plist} yet; skipping the app-bound domains.`);
  process.exit(0);
}

const domains = appBoundDomains(resolveAppUrl(process.env[APP_URL_VARIABLE]));
const buddy = (command: string) =>
  execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plist], {
    stdio: ["ignore", "ignore", "pipe"],
  });

try {
  buddy("Delete :WKAppBoundDomains");
} catch {
  // Not set yet.
}
buddy("Add :WKAppBoundDomains array");
domains.forEach((domain, i) =>
  buddy(`Add :WKAppBoundDomains:${i} string ${domain}`),
);
console.log(`${plist}: WKAppBoundDomains = ${domains.join(", ")}`);
