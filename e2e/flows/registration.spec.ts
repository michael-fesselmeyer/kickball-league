import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import {
  openCheckoutSession,
  sendCheckoutCompleted,
} from "../support/stripe-webhook";

/**
 * A new season, from the admin opening registration to a captain paying
 * their share of a split team fee and a free agent paying their fee.
 * Stripe calls go to stripe-mock, and Stripe's webhook is sent by the test,
 * signed with the flows server's test secret, so nothing leaves the machine.
 */
test.describe.configure({ mode: "serial" });

const SEASON = "Summer 2027";
const SEASON_SLUG = "summer-2027";
const TEAM = "Late Kick Club";

test("an admin creates a season and opens registration", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto("/app/admin/seasons/new");
  await expectNoAxeViolations(page);

  await page.getByLabel("Name").fill(SEASON);
  await page.getByLabel("First game day").fill("2027-06-01");
  await page.getByLabel("Last game day").fill("2027-08-10");
  await page.getByRole("radio", { name: "Per team" }).check();
  await page.getByLabel("Team fee ($)").fill("1200");
  await page.getByLabel("Free agent fee ($)").fill("75");
  await page.getByLabel("Opens", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Closes", { exact: true }).fill("2027-05-15");
  await page.getByLabel("Payment deadline").fill("2027-05-20");
  await page.getByLabel("Smallest roster").fill("12");
  await page.getByLabel("Largest roster").fill("20");
  await page.getByRole("button", { name: "Create season" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/admin/seasons/${SEASON_SLUG}\\?created=1`),
  );

  await page.getByLabel("Status").selectOption({ label: "Registration open" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\?saved=1/);
  await expect(page.getByLabel("Status")).toHaveValue("registration_open");

  // Players sign a waiver before they pay: use the league's current one.
  await page.goto("/app/admin/waivers");
  // A label around a select also names it by the chosen option.
  const seasonWaiver = page.getByLabel(new RegExp(`^${SEASON}`));
  const waiver = page.locator("form").filter({ has: seasonWaiver });
  await seasonWaiver.selectOption({ index: 1 });
  await waiver.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Saved the waiver for ${SEASON}.`,
  );
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("a captain registers a team with split pay and reaches Checkout", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Captain");
  await completeProfile(page);

  await page.goto(`/app/seasons/${SEASON_SLUG}/register`);
  await expect(
    page.getByRole("heading", { name: "Register a team" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  const team = page.getByRole("region", { name: "Register a team" });
  await team.getByLabel("Team name").fill(TEAM);
  await team.getByLabel("Expected roster size").fill("15");
  // $1,200 split 15 ways.
  await expect(
    team.getByRole("radio", { name: /^Split it: everyone pays a fixed \$80 / }),
  ).toBeChecked();
  await team.getByRole("button", { name: "Register the team" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/app/seasons/${SEASON_SLUG}\\?registered=team`),
  );
  await expect(page.getByRole("status")).toContainText(
    "Your team is registered",
  );
  await expect(page.getByText(`Captain of ${TEAM}`)).toBeVisible();
  await expect(page.getByText("Each player pays a fixed $80.")).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Read and sign the waiver" }).click();
  await page
    .getByLabel("I have read the whole waiver and I agree to it.")
    .check();
  await page.getByLabel("Type your full name to sign").fill("Casey Captain");
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Sign the waiver" }).click();
  await expect(page.getByRole("status")).toContainText("Signed.");
  await page.goto(`/app/seasons/${SEASON_SLUG}`);

  // Stripe's hosted page is out of scope: stop at its address.
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await page
    .getByRole("button", { name: "Pay $80 securely with Stripe" })
    .click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);
  await page.context().close();
});

test("Stripe's webhook marks the captain paid once, and a forged one is refused", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Captain");
  const session = await openCheckoutSession("casey.captain@example.test");
  expect(session.totalCents).toBe(8000);

  const forged = await page.request.post("/api/stripe/webhook", {
    data: JSON.stringify({
      id: "evt_forged",
      type: "checkout.session.completed",
    }),
    headers: { "stripe-signature": "t=1,v1=not-a-signature" },
  });
  expect(forged.status()).toBe(400);

  const eventId = `evt_e2e_captain_${Date.now()}`;
  expect(await sendCheckoutCompleted(page.request, session, eventId)).toEqual({
    status: 200,
    outcome: "processed",
  });
  // Stripe retries deliveries; the same event changes nothing the second time.
  expect(await sendCheckoutCompleted(page.request, session, eventId)).toEqual({
    status: 200,
    outcome: "duplicate",
  });

  await page.goto(`/app/seasons/${SEASON_SLUG}`);
  await expect(page.getByText(`You're all set for ${SEASON}.`)).toBeVisible();
  await page.goto(`/app/seasons/${SEASON_SLUG}/team`);
  await expect(page.getByText(/1 signed the waiver, 1 paid\./)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("a player joins the season as a free agent", async ({ browser }) => {
  const page = await pageAs(browser, "Player");
  await completeProfile(page);

  await page.goto(`/app/seasons/${SEASON_SLUG}/register`);
  const freeAgent = page.getByRole("region", { name: "Or join on your own" });
  await expect(freeAgent.getByText("It costs $75.")).toBeVisible();
  await freeAgent.getByRole("button", { name: "Join as a free agent" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/app/seasons/${SEASON_SLUG}\\?registered=free_agent`),
  );
  await expect(page.getByRole("status")).toContainText(
    "You're in the free-agent pool",
  );
  await expect(page.getByText("Registered as a free agent")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("the free agent signs, pays through Checkout and is confirmed by Stripe", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Player");
  await page.goto(`/app/seasons/${SEASON_SLUG}`);
  await page.getByRole("link", { name: "Read and sign the waiver" }).click();
  await page
    .getByLabel("I have read the whole waiver and I agree to it.")
    .check();
  await page.getByLabel("Type your full name to sign").fill("Pat Player");
  await page.getByRole("button", { name: "Sign the waiver" }).click();
  await expect(page.getByRole("status")).toContainText("Signed.");

  await page.goto(`/app/seasons/${SEASON_SLUG}`);
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await page
    .getByRole("button", { name: "Pay $75 securely with Stripe" })
    .click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

  const session = await openCheckoutSession("pat.player@example.test");
  expect(session.totalCents).toBe(7500);
  expect(await sendCheckoutCompleted(page.request, session)).toEqual({
    status: 200,
    outcome: "processed",
  });
  await page.goto(`/app/seasons/${SEASON_SLUG}`);
  await expect(page.getByText(`You're all set for ${SEASON}.`)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});
