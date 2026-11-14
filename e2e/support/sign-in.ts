import { randomBytes } from "node:crypto";
import { type Browser, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Signs someone in who isn't one of the demo personas (a seeded player, or a
 * new person the test makes up), the way a player does: with a one-time email sign-in link. The flows server runs as
 * production and never logs links, so the test writes the link's record to
 * the test database itself, in the shape Better Auth's magic-link plugin
 * stores it, and opens the link. The token is made fresh for each call and
 * works once.
 *
 * Better Auth allows 5 sign-in links a minute from one address, and every
 * flow reaches the server from this machine, so parallel flows would share
 * that allowance and the sixth sign-in in a minute would be refused. Each
 * person signs in from their own address, as real players do, picked from
 * the range set aside for network tests (198.18.0.0/15, RFC 2544).
 */
export async function pageSignedInAs(
  browser: Browser,
  email: string,
): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

/**
 * The same sign-in in a page that is already open, so whatever its browser
 * already holds (a referral link's cookie, say) still applies. An address
 * with no account yet signs up, as a new player's first link does.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": testAddress() });
  const token = randomBytes(24).toString("base64url");
  await withDb((db) =>
    db.query(
      `insert into verification (identifier, value, expires_at)
       values ($1, $2, now() + interval '5 minutes')`,
      [`magic-link:${token}`, JSON.stringify({ type: "magic-link", email })],
    ),
  );
  const link = new URLSearchParams({ token, callbackURL: "/app" });
  await page.goto(`/api/auth/magic-link/verify?${link.toString()}`);
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

/** The address of a team's captain in a season, from the seeded league. */
export async function captainEmail(
  teamName: string,
  seasonSlug: string,
): Promise<string> {
  const { rows } = await withDb((db) =>
    db.query<{ email: string }>(
      `select u.email
         from roster_membership m
         join registration r on r.id = m.registration_id
         join "user" u on u.id = r.user_id
         join team_season ts on ts.id = m.team_season_id
         join team t on t.id = ts.team_id
         join season s on s.id = ts.season_id
        where t.name = $1 and s.slug = $2
          and m.role = 'captain' and m.status = 'active'`,
      [teamName, seasonSlug],
    ),
  );
  const [captain] = rows;
  if (!captain) throw new Error(`${teamName} has no captain in ${seasonSlug}`);
  return captain.email;
}

/** A random address in 198.18.0.0/15, which never routes to a real host. */
function testAddress(): string {
  const [a = 0, b = 0, c = 0] = randomBytes(3);
  return `198.${18 + (a % 2)}.${b}.${(c % 254) + 1}`;
}

async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}
