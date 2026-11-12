type Env = Readonly<Record<string, string | undefined>>;

export type DemoStatus = { on: true } | { on: false; reason: string };

const off = (reason: string): DemoStatus => ({ on: false, reason });

/** The database name from a postgres:// URL, or null if it cannot be read. */
function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || null;
  } catch {
    return null;
  }
}

/**
 * Whether this server runs the demo: invented data, a banner on every page
 * and one-tap "view as" sign-in (docs/adr/0004-demo-mode.md).
 *
 * Off unless every check passes, so a mistake leaves it off:
 * 1. `DEMO_MODE` is exactly "true". It is a server variable (no NEXT_PUBLIC_
 *    prefix), so nothing in a browser can set or read it.
 * 2. The database's name contains "demo". The production database is not
 *    named that way, so pointing the demo at it turns demo mode off.
 * 3. On a Vercel production deployment, the project's production address
 *    contains "demo", so the league's own project can never run it.
 * 4. Stripe is not in live mode: the demo never takes real money.
 */
export function demoStatus(env: Env): DemoStatus {
  if (env.DEMO_MODE !== "true") return off('DEMO_MODE is not "true".');

  const database = databaseName(env.DATABASE_URL);
  if (!database) return off("DATABASE_URL does not name a database.");
  if (!/demo/i.test(database))
    return off(
      `The database "${database}" is not a demo database (its name must contain "demo").`,
    );

  if (env.VERCEL_ENV === "production") {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL ?? "";
    if (!/demo/i.test(host))
      return off(
        'This is the league\'s production deployment (its address does not contain "demo").',
      );
  }

  if (/^[sr]k_live_/.test(env.STRIPE_SECRET_KEY ?? ""))
    return off("Stripe is in live mode.");

  return { on: true };
}

/**
 * The reset wipes and reseeds the demo league, so it runs only where demo
 * mode is fully on: never against a development or production database.
 */
export function canResetDemo(env: Env): DemoStatus {
  const status = demoStatus(env);
  return status.on
    ? status
    : off(`Refusing to reset: demo mode is off. ${status.reason}`);
}
