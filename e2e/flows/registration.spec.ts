import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import {
  moveDeadline,
  openCheckoutSession,
  sendCardSaved,
  sendChargeRefunded,
  sendCheckoutCompleted,
  sendGuaranteeCharged,
} from "../support/stripe-webhook";

/**
 * A new season, from the admin opening registration to a captain paying
 * their share of a split team fee, a free agent paying their fee with a
 * promo code, and the admin refunding part of one payment and all of the
 * other. Then money, part two: league credit, the team waitlist, and the
 * captain's saved card paying the team's balance at the deadline. Stripe calls go to stripe-mock, and Stripe's webhook is sent by the
 * test, signed with the flows server's test secret, so nothing leaves the
 * machine.
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
  const session = await openCheckoutSession(
    "casey.captain@example.test",
    SEASON_SLUG,
  );
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

test("an admin adds a promo code for the season", async ({ browser }) => {
  const page = await pageAs(browser, "Admin");
  await page.goto(`/app/admin/seasons/${SEASON_SLUG}`);
  await page.getByRole("link", { name: "Promo codes" }).click();
  await expect(
    page.getByRole("heading", { name: "Promo codes" }),
  ).toBeVisible();
  await expect(page.getByText("No promo codes yet.")).toBeVisible();

  await page
    .getByRole("textbox", { name: "Code", exact: true })
    .fill("kickoff10");
  await page.getByRole("radio", { name: "A percentage" }).check();
  await page.getByLabel("How much (percent or dollars)").fill("10");
  await page.getByLabel("How many times it can be used (optional)").fill("5");
  await page.getByRole("button", { name: "Add promo code" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Promo code added. Players can use it at checkout now.",
  );
  const row = page.getByRole("row", { name: /KICKOFF10/ });
  await expect(row).toContainText("10% off");
  await expect(row).toContainText("0 of 5");
  await expect(row).toContainText("Live");
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

test("the free agent signs, pays with a promo code and is confirmed by Stripe", async ({
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
  const pay = page.getByRole("button", {
    name: "Pay $75 securely with Stripe",
  });
  await page.getByLabel("Promo code (optional)").fill("NOPE");
  await pay.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "promo code" }),
  ).toHaveText(
    "That promo code doesn't exist. Check the spelling and try again.",
  );
  await expectNoAxeViolations(page);

  await page.getByLabel("Promo code (optional)").fill("kickoff10");
  await pay.click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

  // 10% off $75: Stripe is asked for $67.50.
  const session = await openCheckoutSession(
    "pat.player@example.test",
    SEASON_SLUG,
  );
  expect(session.totalCents).toBe(6750);
  expect(await sendCheckoutCompleted(page.request, session)).toEqual({
    status: 200,
    outcome: "processed",
  });
  await page.goto(`/app/seasons/${SEASON_SLUG}`);
  await expect(page.getByText(`You're all set for ${SEASON}.`)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("the free agent takes the quiz and starts a friend group", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Player");
  await page.goto(`/app/seasons/${SEASON_SLUG}`);
  await page
    .getByRole("link", {
      name: "Five quick questions and an optional friend code",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find your team" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("radio", { name: "A season or two" }).check();
  await page.getByRole("checkbox", { name: "Outfield" }).check();
  await page.getByRole("radio", { name: "Most weeks" }).check();
  await page
    .getByRole("radio", { name: "Fun first, but I'd like to win some" })
    .check();
  await page.getByRole("radio", { name: "I'd help a captain" }).check();
  await page.getByRole("button", { name: "Save my answers" }).click();
  await expect(page).toHaveURL(/\?quiz=saved/);
  await expect(page.getByText("Take the team-fit quiz")).toBeVisible();

  await page.goto(`/app/seasons/${SEASON_SLUG}/quiz`);
  await page.getByRole("button", { name: "Start a group" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Group started. Share the code with your friends.",
  );
  await expect(
    page.getByText(/Your friend code is [A-Z2-9]{3}-[A-Z2-9]{3}/),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("an admin applies the matcher's suggestion", async ({ browser }) => {
  const page = await pageAs(browser, "Admin");
  await page.goto(`/app/admin/seasons/${SEASON_SLUG}/free-agents`);
  await expect(
    page.getByRole("heading", { name: "Free-agent matcher" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  const apply = page.getByRole("button", { name: new RegExp(`to ${TEAM}$`) });
  await expect(apply).toHaveCount(1);
  await apply.click();
  await expect(page.getByRole("status")).toHaveText(
    "Suggestion applied. They're on the team.",
  );
  await page.goto(`/app/admin/seasons/${SEASON_SLUG}/registrations`);
  await expect(
    page.getByRole("article", { name: TEAM }).getByRole("row"),
  ).toHaveCount(3);
  await page.context().close();
});

test("an admin refunds part of one payment and all of another through Stripe", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Admin");
  await page.goto(`/app/admin/seasons/${SEASON_SLUG}/registrations`);
  const captain = page.getByRole("row", { name: /Casey/ });
  const freeAgent = page.getByRole("row", { name: /Pat/ });
  await expect(captain).toContainText("Paid online");
  await expect(freeAgent).toContainText("Paid online");

  // Part of the captain's $80 share goes back.
  await captain.locator("summary", { hasText: "Refund" }).click();
  await captain.getByLabel(/^Amount to refund/).fill("20");
  await captain.getByLabel(/^Reason for refunding/).fill("Shirt not needed");
  await expectNoAxeViolations(page);
  await captain.getByRole("button", { name: "Refund through Stripe" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Refund sent to Stripe. It shows here once Stripe confirms it.",
  );
  await expect(captain).toContainText("Refund of $20 pending");

  const eventId = `evt_e2e_refund_${Date.now()}`;
  expect(
    await sendChargeRefunded(
      page.request,
      "casey.captain@example.test",
      SEASON_SLUG,
      eventId,
    ),
  ).toEqual({ status: 200, outcome: "processed", refundedCents: 2000 });
  // A replayed refund event changes nothing.
  expect(
    await sendChargeRefunded(
      page.request,
      "casey.captain@example.test",
      SEASON_SLUG,
      eventId,
    ),
  ).toEqual({ status: 200, outcome: "duplicate", refundedCents: 2000 });
  await page.reload();
  await expect(captain).toContainText("Refunded $20 of $80");
  await expect(captain).not.toContainText("pending");

  // A blank amount refunds everything left: the free agent's $67.50.
  await freeAgent.locator("summary", { hasText: "Refund" }).click();
  await expect(freeAgent.getByLabel(/^Amount to refund/)).toHaveAttribute(
    "placeholder",
    "All $67.50",
  );
  await freeAgent
    .getByRole("button", { name: "Refund through Stripe" })
    .click();
  await expect(freeAgent).toContainText("Refund of $67.50 pending");
  expect(
    await sendChargeRefunded(
      page.request,
      "pat.player@example.test",
      SEASON_SLUG,
    ),
  ).toEqual({ status: 200, outcome: "processed", refundedCents: 6750 });
  await page.reload();
  await expect(freeAgent).toContainText("Refunded $67.50");
  await expect(freeAgent.locator("summary", { hasText: "Refund" })).toHaveCount(
    0,
  );
  await expectNoAxeViolations(page);

  // The promo code counts the free agent's use.
  await page.goto(`/app/admin/seasons/${SEASON_SLUG}/promo-codes`);
  await expect(page.getByRole("row", { name: /KICKOFF10/ })).toContainText(
    "1 of 5",
  );
  await page.context().close();
});

test("an admin gives a player league credit, and the player sees it", async ({
  browser,
}) => {
  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/credit");
  await expectNoAxeViolations(admin);
  await admin.getByLabel("Player's email").fill("pat.player@example.test");
  await admin.getByLabel("Amount in dollars").fill("10");
  await admin
    .getByLabel("Why (the player sees this)")
    .fill("Thanks for lining the fields");
  await admin.getByRole("button", { name: "Give credit" }).click();
  await expect(admin.getByRole("status")).toContainText("Credit given.");
  await expect(
    admin.getByRole("region", { name: "Who holds credit" }),
  ).toContainText("pat.player@example.test");
  await admin.context().close();

  const player = await pageAs(browser, "Player");
  await player.goto("/app/profile");
  const credit = player.getByRole("region", { name: "League credit" });
  await expect(credit).toContainText("$10 comes off your next fee");
  await expect(credit).toContainText("Thanks for lining the fields");
  await player.getByRole("button", { name: "Get my invite link" }).click();
  await expect(
    player.getByRole("region", { name: /Bring a friend/ }),
  ).toContainText(/\/r\/[A-Z2-9]{8}/);
  await expectNoAxeViolations(player);
  await player.context().close();
});

test("a full season sends the next captain to the waitlist, then offers a spot", async ({
  browser,
}) => {
  // A second team registers, then the admin caps the season at two.
  const admin = await pageAs(browser, "Admin");
  await completeProfile(admin);
  await admin.goto(`/app/seasons/${SEASON_SLUG}/register`);
  const second = admin.getByRole("region", { name: "Register a team" });
  await second.getByLabel("Team name").fill("Front Office");
  await second.getByLabel("Expected roster size").fill("12");
  await second.getByRole("button", { name: "Register the team" }).click();
  await expect(admin).toHaveURL(/\?registered=team/);
  const setLimit = async (teams: string) => {
    await admin.goto(`/app/admin/seasons/${SEASON_SLUG}`);
    await admin.getByLabel("Most teams").fill(teams);
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin).toHaveURL(/\?saved=1/);
  };
  await setLimit("2");

  const ref = await pageAs(browser, "Ref");
  await completeProfile(ref);
  await ref.goto(`/app/seasons/${SEASON_SLUG}/register`);
  await expect(ref.getByText("All 2 team spots are taken.")).toBeVisible();
  await expectNoAxeViolations(ref);
  await ref.getByLabel("Team name (optional)").fill("Whistle Blowers");
  await ref.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(ref.getByRole("status")).toContainText(
    "You're on the waitlist.",
  );
  await expect(ref.getByText("You're #1 on the waitlist")).toBeVisible();

  await admin.goto(`/app/admin/seasons/${SEASON_SLUG}/waitlist`);
  await expect(
    admin.getByRole("listitem").filter({ hasText: "Reese" }),
  ).toContainText("Whistle Blowers");
  await expectNoAxeViolations(admin);

  // A third spot opens: the first in line is offered it at once.
  await setLimit("3");
  await admin.goto(`/app/admin/seasons/${SEASON_SLUG}/waitlist`);
  await expect(
    admin.getByRole("listitem").filter({ hasText: "Reese" }),
  ).toContainText("Offered until");
  await ref.reload();
  await expect(ref.getByText("A spot is yours.")).toBeVisible();
  await expect(
    ref.getByRole("button", { name: "Register the team" }),
  ).toBeVisible();
  await admin.context().close();
  await ref.context().close();
});

test("a captain guarantees the team's balance with a saved card", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Captain");
  await page.goto(`/app/seasons/${SEASON_SLUG}/team`);
  const fee = page.getByRole("region", { name: "Team fee" });
  await expect(fee).toContainText("$80 of $1,200 paid.");
  await expect(fee).toContainText("$1,120 left");
  await expectNoAxeViolations(page);

  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await fee.getByRole("button", { name: "Save a card as guarantee" }).click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

  const eventId = `evt_e2e_card_${Date.now()}`;
  expect(
    await sendCardSaved(page.request, "casey.captain@example.test", eventId),
  ).toEqual({ status: 200, outcome: "processed" });
  expect(
    await sendCardSaved(page.request, "casey.captain@example.test", eventId),
  ).toEqual({ status: 200, outcome: "duplicate" });
  await page.goto(`/app/seasons/${SEASON_SLUG}/team`);
  await expect(fee).toContainText("Visa ending 4242 guarantees the balance.");
  await expectNoAxeViolations(page);
  await page.context().close();
});

test("at the deadline the captain is warned, then the saved card pays the balance", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Captain");
  const runJob = async () => {
    const response = await page.request.get("/api/jobs/guarantee-charges", {
      headers: { authorization: "Bearer e2e-cron-placeholder" },
    });
    expect(response.status()).toBe(200);
    return (await response.json()) as { warned: number; charged: number };
  };

  // Three days out, the captain is warned.
  await moveDeadline(SEASON_SLUG, new Date(Date.now() + 3_600_000));
  expect(await runJob()).toMatchObject({ warned: 1, charged: 0 });
  expect(await runJob()).toMatchObject({ warned: 0, charged: 0 });
  await page.goto(`/app/seasons/${SEASON_SLUG}/team`);
  const fee = page.getByRole("region", { name: "Team fee" });
  await expect(fee).toContainText(
    "It will be charged for whatever is still unpaid on",
  );

  // 72 hours after the warning, the deadline has passed: one charge.
  const now = Date.now();
  await moveDeadline(
    SEASON_SLUG,
    new Date(now - 60_000),
    new Date(now - 73 * 3_600_000),
  );
  expect(await runJob()).toMatchObject({ warned: 0, charged: 1 });
  expect(await runJob()).toMatchObject({ charged: 0 });
  await page.reload();
  await expect(fee).toContainText("The deadline charge is processing.");

  expect(
    await sendGuaranteeCharged(page.request, "casey.captain@example.test"),
  ).toEqual({ status: 200, outcome: "processed", cents: 112_000 });
  await page.reload();
  await expect(fee).toContainText("All paid. You're in!");
  await expect(fee).toContainText("The deadline charge went through.");
  await expectNoAxeViolations(page);
  await page.context().close();
});
