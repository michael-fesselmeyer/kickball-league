/**
 * npm run demo:reset: puts the demo deployment's database back to fresh seed
 * data and the four view-as personas. Meant to run nightly.
 *
 * Refuses (exit code 1, before connecting to anything) unless demo mode is
 * fully on for this environment: DEMO_MODE=true and a database whose name
 * contains "demo" (src/lib/demo/guard.ts). Safe to repeat: the seed replaces
 * only seed-owned rows, in one transaction, so a failed or overlapping run
 * leaves the previous data in place.
 */
import { existsSync } from "node:fs";
import { canResetDemo } from "../src/lib/demo/guard";

if (!process.env.DATABASE_URL && existsSync(".env.local"))
  process.loadEnvFile(".env.local");

const allowed = canResetDemo(process.env);
if (!allowed.on) {
  console.error(allowed.reason);
  process.exit(1);
}

console.info("Demo mode is on. Resetting the demo league.");
// The seed script runs on import and sets the exit code itself.
void import("./seed");
