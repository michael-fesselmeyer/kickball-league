import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import { expectNoAxeViolations } from "../support/axe";
import {
  type Member,
  memberPage,
  saveProfile,
  signInMember,
} from "../support/people";
import { pageAs } from "../support/personas";
import {
  confirmAge,
  leagueDate,
  openSeason,
  signWaiver,
} from "../support/season";
import {
  openCheckoutSession,
  sendCheckoutCompleted,
} from "../support/stripe-webhook";

/**
 * A new player's first season, from their first sign-in to a team, across
 * the registration features (roadmap, Phase 1 week 4) and league credit:
 *
 * - Profile: under 18 is refused, then gender, shirt size and an emergency
 *   contact are saved.
 * - Pricing: the early-bird price applies before its date, to a captain
 *   paying in full and to a free agent.
 * - Waiver: nobody reaches payment unsigned; signing stores the typed name,
 *   the time, the IP and a hash of the exact text.
 * - Payment: only Stripe's signed webhook marks a fee paid.
 * - Reminders: the daily job queues an unpaid player's reminder three days
 *   before the deadline, once however often it runs.
 * - Free agents: register, sign and pay, appear in the admin's pool and are
 *   placed on a team by hand; the captain's roster board shows them joined,
 *   signed and paid.
 * - Referrals: a friend who signs up through the player's link and pays
 *   earns the player $10 of league credit.
 *
 * Everyone but the admin is made up for this journey (`example.test`), so
 * no other flow sees their accounts change.
 */
const SEASON = "Fall Social 2027";
const SLUG = "fall-social-2027";
const TEAM = "Lantern Kickers";

const newcomer: Member = {
  first: "Robin",
  last: "Quill",
  email: "robin.quill@example.test",
};
const captainPerson: Member = {
  first: "Morgan",
  last: "Vale",
  email: "morgan.vale@example.test",
  gender: "Man",
};
const friend: Member = {
  first: "Sky",
  last: "Fenn",
  email: "sky.fenn@example.test",
  gender: "Nonbinary",
};

/** Pays from the season page: Checkout is stubbed, the webhook is signed. */
async function pay(page: Page, amount: string, email: string) {
  await page.goto(`/app/seasons/${SLUG}`);
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await page
    .getByRole("button", { name: `Pay ${amount} securely with Stripe` })
    .click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);
  // Leaving for Checkout changes nothing: the fee is not paid yet.
  await page.goto(`/app/seasons/${SLUG}`);
  await expect(page.getByText(`You're all set for ${SEASON}.`)).toHaveCount(0);
  const session = await openCheckoutSession(email, SLUG);
  expect(await sendCheckoutCompleted(page.request, session)).toEqual({
    status: 200,
    outcome: "processed",
  });
  await page.reload();
  await expect(page.getByText(`You're all set for ${SEASON}.`)).toBeVisible();
}

/** Registers the signed-in person as a free agent and checks the price. */
async function joinPool(page: Page, price: string) {
  await page.goto(`/app/seasons/${SLUG}/register`);
  const pool = page.getByRole("region", { name: "Or join on your own" });
  await expect(pool.getByText(`It costs ${price}.`)).toBeVisible();
  await confirmAge(pool);
  await pool.getByRole("button", { name: "Join as a free agent" }).click();
  await expect(page.getByRole("status")).toContainText(
    "You're in the free-agent pool",
  );
}

async function storedSignature(email: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{
      name: string;
      ip: string | null;
      matches: boolean;
      seconds: number;
    }>(
      `select ws.signed_name as name, host(ws.ip) as ip,
              ws.body_sha256 = w.body_sha256 as matches,
              extract(epoch from now() - ws.signed_at)::int as seconds
         from waiver_signature ws
         join waiver w on w.id = ws.waiver_id
         join season s on s.id = ws.season_id
         join "user" u on u.id = ws.user_id
        where u.email = $1 and s.slug = $2`,
      [email, SLUG],
    );
    return rows;
  } finally {
    await db.end();
  }
}

/** The database's clock, which stamps the reminders. */
async function databaseNow(): Promise<Date> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ now: Date }>("select now() as now");
    const [row] = rows;
    if (!row) throw new Error("The database has no clock");
    return row.now;
  } finally {
    await db.end();
  }
}

/**
 * The payment reminders queued for a person since `since`, by days left. A
 * made-up person outlives a reseed, so earlier runs' reminders are left out.
 */
async function reminders(email: string, since: Date): Promise<number[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ days: number }>(
      `select (m.payload->>'daysLeft')::int as days
         from message m join "user" u on u.id = m.user_id
        where u.email = $1 and m.template = 'payment_reminder'
          and m.payload->>'seasonSlug' = $2 and m.created_at >= $3`,
      [email, SLUG, since],
    );
    return rows.map((r) => r.days);
  } finally {
    await db.end();
  }
}

test("a new player signs up, pays the early-bird price, is placed on a team and earns a referral credit", async ({
  browser,
}) => {
  // Four people, two payments and a referral.
  test.slow();
  const admin = await pageAs(browser, "Admin");
  await openSeason(admin, {
    name: SEASON,
    slug: SLUG,
    firstGameDay: leagueDate(90),
    lastGameDay: leagueDate(150),
    // Registration and payment close in three days, inside the reminders'
    // week; the early bird ends the day before.
    registrationCloses: leagueDate(3),
    teamFee: 900,
    freeAgentFee: 80,
    rosterMin: 8,
    rosterMax: 20,
    earlyBird: { discount: 10, endsOn: leagueDate(2) },
  });

  await test.step("a captain registers a team and pays the whole fee", async () => {
    const captain = await memberPage(browser, captainPerson);
    await captain.goto(`/app/seasons/${SLUG}/register`);
    await expect(captain.getByText(/Early-bird pricing until /)).toBeVisible();
    const team = captain.getByRole("region", { name: "Register a team" });
    await team.getByLabel("Team name").fill(TEAM);
    await team.getByLabel("Expected roster size").fill("12");
    await team
      .getByRole("radio", { name: /^I'll pay it all: \$890, / })
      .check();
    await confirmAge(team);
    await team.getByRole("button", { name: "Register the team" }).click();
    await expect(captain.getByRole("status")).toContainText(
      "Your team is registered",
    );
    await signWaiver(captain, SLUG, "Morgan Vale");
    await pay(captain, "$890", captainPerson.email);
    await captain.context().close();
  });

  const player = await memberPage(browser, newcomer);

  await test.step("the profile refuses anyone under 18", async () => {
    await saveProfile(player, newcomer, leagueDate(-17 * 365));
    await expect(
      player.getByText("Players must be 18 or older."),
    ).toBeVisible();
    await expect(player.getByLabel("Birth date")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await saveProfile(player, newcomer);
    await expect(player).toHaveURL(/\/app\/profile\?saved=1/);
  });

  await test.step("the waiver comes before payment and is stored as signed", async () => {
    await joinPool(player, "$70");
    await player.goto(`/app/seasons/${SLUG}`);
    await expect(
      player.getByRole("link", { name: "Read and sign the waiver" }),
    ).toBeVisible();
    await expect(
      player.getByRole("button", { name: /securely with Stripe$/ }),
    ).toHaveCount(0);
    await expectNoAxeViolations(player);

    // The daily reminders job finds the unpaid player three days out, once
    // however often it runs.
    const since = await databaseNow();
    for (let run = 0; run < 2; run++) {
      const job = await player.request.get("/api/jobs/payment-reminders", {
        headers: { authorization: "Bearer e2e-cron-placeholder" },
      });
      expect(job.status()).toBe(200);
    }
    const queued = await reminders(newcomer.email, since);
    expect(queued).toHaveLength(1);
    // Three calendar days out, or two and a bit late in the evening.
    expect(queued[0]).toBeGreaterThanOrEqual(2);
    expect(queued[0]).toBeLessThanOrEqual(3);

    await signWaiver(player, SLUG, "Robin Quill");
    const [signature] = await storedSignature(newcomer.email);
    expect(signature).toMatchObject({ name: "Robin Quill", matches: true });
    expect(signature?.ip).toBeTruthy();
    expect(signature?.seconds).toBeLessThan(120);

    await pay(player, "$70", newcomer.email);
  });

  await test.step("a friend joins through the player's link and pays", async () => {
    await player.goto("/app/profile");
    const invite = player.getByRole("region", { name: /Bring a friend/ });
    const shown = invite.getByText(/\/r\/[A-Z2-9]{8}/);
    const make = invite.getByRole("button", { name: "Get my invite link" });
    // A player keeps one link: a later run finds it already made.
    await expect(shown.or(make)).toBeVisible();
    if (await make.isVisible()) await make.click();
    const link = await shown.textContent();
    const code = /\/r\/([A-Z2-9]{8})/.exec(link ?? "")?.[1];
    expect(code).toBeTruthy();

    // The friend opens the link before they have an account.
    const friendPage = await (await browser.newContext()).newPage();
    await friendPage.goto(`/r/${code}`);
    await expect(friendPage).toHaveURL(/\/$/);
    await signInMember(friendPage, friend);
    await joinPool(friendPage, "$70");
    await signWaiver(friendPage, SLUG, "Sky Fenn");
    await pay(friendPage, "$70", friend.email);
    await friendPage.context().close();

    await player.goto("/app/profile");
    const credit = player.getByRole("region", { name: "League credit" });
    await expect(credit).toContainText("$10 comes off your next fee");
    await expect(credit).toContainText("Referral");
  });

  await test.step("the admin places the player on a team by hand", async () => {
    await admin.goto(`/app/admin/seasons/${SLUG}/registrations`);
    await admin
      .getByRole("combobox", { name: "Team for Robin Quill" })
      .selectOption({ label: `${TEAM} (1)` });
    await admin.getByRole("button", { name: "Place Robin Quill" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Free agent placed on the team.",
    );
    // The friend is still in the pool.
    await expect(
      admin.getByRole("combobox", { name: "Team for Sky Fenn" }),
    ).toBeVisible();
    await admin.context().close();

    await player.goto(`/app/seasons/${SLUG}`);
    await expect(player.getByText(TEAM).first()).toBeVisible();
    await player.context().close();

    const captain = await memberPage(browser, captainPerson);
    await captain.goto(`/app/seasons/${SLUG}/team`);
    await expect(
      captain.getByText(/2 signed the waiver, 2 paid\./),
    ).toBeVisible();
    await expect(captain.getByRole("row", { name: /Robin/ })).toBeVisible();
    await expectNoAxeViolations(captain);
    await captain.context().close();
  });
});
