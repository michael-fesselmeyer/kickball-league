import { execFileSync } from "node:child_process";

/**
 * The flows change the league (a new season, a published schedule, a final
 * score, a rain-out), so every run starts from a fresh seed. The seed only
 * replaces seed-owned rows, in one transaction (scripts/seed.ts).
 */
export default function globalSetup() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL to a migrated local database whose name contains 'demo' (see README, Scripts).",
    );
  execFileSync("npm", ["run", "--silent", "seed"], { stdio: "inherit" });
}
