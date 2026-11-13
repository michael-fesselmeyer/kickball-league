/**
 * Creates the league's VAPID key pair for web push and writes it to
 * .env.local. Prints only the public key. For hosting, copy both values
 * from .env.local into the provider's encrypted settings; never paste the
 * private key anywhere else. Refuses to replace a key that is already set.
 *
 *   npm run push:keys
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { withVapidKeys } from "../src/lib/push/env-file";
import { generateVapidKeys } from "../src/lib/push/web-push";

const file = ".env.local";
const keys = generateVapidKeys();
const current = existsSync(file) ? readFileSync(file, "utf8") : "";
const next = withVapidKeys(current, keys);
if (next === null) {
  console.error(
    `${file} already has a VAPID key. Remove both VAPID_ lines first if you really mean to replace it; every subscribed device will need to opt in again.`,
  );
  process.exit(1);
}
writeFileSync(file, next, { mode: 0o600 });
console.info(`Added a VAPID key pair to ${file}.`);
console.info(`Public key: ${keys.publicKey}`);
