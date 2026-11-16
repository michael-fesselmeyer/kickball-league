/**
 * Writes the iOS and Android shells' own pages into mobile/www/ for the
 * site at MOBILE_APP_URL (from .env.local or the environment). Run by
 * `npm run mobile:sync` before Capacitor copies them into the native
 * projects; the folder is generated, so git ignores it.
 *
 *   npm run mobile:web
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { APP_URL_VARIABLE, resolveAppUrl } from "../src/lib/mobile/app-url";
import { shellPages } from "../src/lib/mobile/shell-pages";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const app = resolveAppUrl(process.env[APP_URL_VARIABLE]);
const dir = join("mobile", "www");
mkdirSync(dir, { recursive: true });
for (const [file, html] of Object.entries(shellPages(app))) {
  writeFileSync(join(dir, file), html);
  console.log(join(dir, file));
}
console.log(`The apps will open ${app.origin}.`);
