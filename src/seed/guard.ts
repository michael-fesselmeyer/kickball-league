import type { Result } from "@/domain/result";
import { err, ok } from "@/domain/result";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Seeding writes invented data, so it must never run against the real
 * league. Production is refused unless it is the demo deployment, whose whole
 * database is seed data (docs/architecture.md, section 10).
 */
export function canSeed(env: Env): Result<true, string> {
  if (!env.DATABASE_URL) return err("DATABASE_URL is not set.");
  const production =
    env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  if (production && env.DEMO_MODE !== "true") {
    return err(
      "Refusing to seed a production database. Only the demo deployment (DEMO_MODE=true) may be seeded.",
    );
  }
  return ok(true);
}
