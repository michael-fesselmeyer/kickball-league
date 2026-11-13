import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";
import {
  openTicketCheckout,
  sendCheckoutCompleted,
} from "../support/stripe-webhook";

/**
 * Paid event tickets (ADR 0027). An admin posts a ticketed event with one
 * spot and a member price, and gives Reese Ref some league credit. Reese
 * buys the ticket with the credit applied and pays the rest through Stripe
 * (stripe-mock, with the webhook signed here). Casey Captain joins the
 * waitlist. The admin sees Reese in the ticket list, checks them in, and
 * refunds the ticket: the credit goes back and Casey is offered the spot.
 */
test("a member buys a ticket with credit, an admin checks them in, and a refund frees the spot", async ({
  browser,
}) => {
  // Three people sign in and several screens get an axe scan.
  test.slow();
  const slug = "karaoke-night-2027-03-26";
  const eventPage = `/app/events/${slug}`;
  const refEmail = "reese.ref@example.test";

  const admin = await pageAs(browser, "Admin");
  await admin.goto("/app/admin/events/new");
  await admin.getByLabel("Kind").selectOption({ label: "Bar night" });
  await admin.getByLabel("Name").fill("Karaoke night");
  await admin
    .getByLabel("Place")
    .fill("The Mic Drop (demo venue), 3 Example St");
  await admin.getByLabel("Date", { exact: true }).fill("2027-03-26");
  await admin.getByLabel("Starts at").fill("20:00");
  await admin.getByLabel("Ends at").fill("23:00");
  await admin.getByLabel("Capacity (optional)").fill("1");
  await admin.getByLabel("Ticket price (optional)").fill("15");
  await admin.getByLabel("Member price (optional)").fill("12");
  await expectNoAxeViolations(admin);
  await admin.getByRole("button", { name: "Create event" }).click();
  await expect(admin.getByRole("status").first()).toHaveText(
    "Event created. It's on the events page now.",
  );
  await expect(
    admin.getByRole("heading", { name: "Tickets (0 of 1 sold)" }),
  ).toBeVisible();

  await admin.goto(`/events/${slug}`);
  await expect(admin.getByText("$15 ($12 for members)")).toBeVisible();
  await expect(admin.getByRole("link", { name: "Get a ticket" })).toBeVisible();

  await admin.goto("/app/admin/credit");
  await admin.getByLabel("Player's email").fill(refEmail);
  await admin.getByLabel("Amount in dollars").fill("5");
  await admin
    .getByLabel("Why (the player sees this)")
    .fill("Warm-up for karaoke night");
  await admin.getByRole("button", { name: "Give credit" }).click();
  await expect(admin.getByRole("status")).toContainText("Credit given.");

  // Reese pays the member price, $5 of it with credit.
  const ref = await pageAs(browser, "Ref");
  await ref.goto(eventPage);
  const panel = ref.getByRole("region", { name: "Your ticket" });
  await expect(panel).toContainText("$15 ($12 for members)");
  await expect(panel).toContainText("1 of 1 spots left.");
  await expect(ref.getByLabel("Use $5 of my league credit")).toBeChecked();
  await expectNoAxeViolations(ref);
  await ref.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe Checkout</title><h1>Checkout</h1>",
    }),
  );
  await ref.getByRole("button", { name: "Buy a ticket for $12" }).click();
  await expect(ref).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

  // Stripe confirms the $7 card payment; a replay changes nothing.
  const session = await openTicketCheckout(refEmail, slug);
  expect(session.totalCents).toBe(700);
  const eventId = `evt_e2e_ticket_${Date.now()}`;
  expect(await sendCheckoutCompleted(ref.request, session, eventId)).toEqual({
    status: 200,
    outcome: "processed",
  });
  expect(await sendCheckoutCompleted(ref.request, session, eventId)).toEqual({
    status: 200,
    outcome: "duplicate",
  });
  await ref.goto(`${eventPage}?ticket=paid`);
  await expect(ref.getByRole("status").first()).toHaveText(
    "Thanks! Your ticket is below.",
  );
  const ticket = ref.getByRole("group", { name: "Your check-in code" });
  await expect(ticket).toContainText("Show this at the door.");
  const code = /([A-HJ-NP-Z2-9]{3}) ([A-HJ-NP-Z2-9]{3})/.exec(
    (await ticket.textContent()) ?? "",
  );
  expect(code).not.toBeNull();
  await expectNoAxeViolations(ref);
  await ref.goto("/app/events");
  await expect(ref.getByRole("link", { name: /Karaoke night/ })).toContainText(
    `Your ticket: ${code?.[0]}`,
  );

  // The event is full now: Casey joins the waitlist.
  const captain = await pageAs(browser, "Captain");
  await captain.goto(eventPage);
  await expect(captain.getByText("All 1 spots are taken.")).toBeVisible();
  await captain.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(
    captain.getByText("You're number 1 on the waitlist."),
  ).toBeVisible();

  // The admin sees Reese's ticket, checks them in, then refunds it.
  await admin.goto(`/app/admin/events/${slug}`);
  await expect(
    admin.getByRole("heading", { name: "Tickets (1 of 1 sold)" }),
  ).toBeVisible();
  const holder = admin
    .getByRole("region", { name: /^Tickets/ })
    .getByRole("listitem")
    .filter({ hasText: "Reese" });
  await expect(holder).toContainText("$7 card + $5 credit");
  await expect(holder).toContainText(code?.[0] ?? "missing");
  await expectNoAxeViolations(admin);
  await admin
    .getByLabel("Check-in code")
    .fill(`${code?.[1]}${code?.[2]}`.toLowerCase());
  await admin.getByRole("button", { name: "Check in" }).click();
  await expect(admin.getByText("Reese Ref is checked in.")).toBeVisible();
  await expect(holder).toContainText("Checked in at");

  await holder.getByText(/^Refund Reese/).click();
  await holder.getByLabel("Reason (optional)").fill("Can't make it after all");
  await holder.getByLabel("Yes, refund this ticket").check();
  await holder.getByRole("button", { name: "Refund the ticket" }).click();
  await expect(
    admin.getByText(
      "Refunded. The ticket is cancelled, the buyer got an email, and the spot went to the waitlist.",
    ),
  ).toBeVisible();
  await expect(
    admin.getByRole("heading", { name: "Tickets (0 of 1 sold)" }),
  ).toBeVisible();
  await expect(
    admin.getByRole("heading", { name: "Refunded (1)" }),
  ).toBeVisible();
  await expectNoAxeViolations(admin);

  // The spot is offered to Casey, first in line.
  await captain.reload();
  await expect(
    captain.getByText(/A spot opened up and it's held for you until/),
  ).toBeVisible();
  await expect(
    captain.getByRole("button", { name: "Buy a ticket for $12" }),
  ).toBeVisible();
  await expectNoAxeViolations(captain);

  // Reese's credit is back, and the ticket is gone.
  await ref.goto(eventPage);
  await expect(ref.getByText("Show this at the door.")).toHaveCount(0);
  await ref.goto("/app/profile");
  await expect(
    ref.getByRole("region", { name: "League credit" }),
  ).toContainText("$5");

  await admin.context().close();
  await ref.context().close();
  await captain.context().close();
});
