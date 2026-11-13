import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

/** The seeded events (src/seed/events.ts). */
const BBQ = "/events/spring-kickoff-bbq-2027-04-10";

test("the events page lists what's coming up and is accessible", async ({
  page,
}) => {
  await page.goto("/events");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "League events",
  );
  const upcoming = page.getByRole("region", { name: "Coming up" });
  await expect(
    upcoming.getByRole("link", { name: /Spring kickoff BBQ/ }),
  ).toContainText("Full: waitlist open");
  await expect(
    page.getByRole("link", { name: "Download .ics" }),
  ).toHaveAttribute("href", "/events/calendar.ics");
  await expectNoAxeViolations(page);
});

test("an event page shows its spots, carries structured data and is accessible", async ({
  page,
}) => {
  await page.goto(BBQ);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Spring kickoff BBQ",
  );
  await expect(page.getByText("All 12 spots are taken")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Join the waitlist" }),
  ).toHaveAttribute("href", "/app/events/spring-kickoff-bbq-2027-04-10");
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  const types = (JSON.parse(jsonLd ?? "[]") as { "@type": string }[]).map(
    (node) => node["@type"],
  );
  expect(types).toEqual(["SocialEvent", "BreadcrumbList"]);
  await expectNoAxeViolations(page);
});

test("theme weeks show on the public schedule for their game days", async ({
  page,
}) => {
  await page.goto("/seasons/fall-2026/schedule");
  const day = page.getByRole("region", { name: "Tuesday, October 27" });
  await expect(
    page.getByRole("link", { name: "Theme week: Costume week" }),
  ).toHaveAttribute("href", "/events/costume-week-2026-10-26");
  await expect(day).toBeVisible();
});

test("the events calendar feed lists every event", async ({ request }) => {
  const response = await request.get("/events/calendar.ics");
  expect(response.headers()["content-type"]).toBe(
    "text/calendar; charset=utf-8",
  );
  const body = await response.text();
  expect(body).toContain("SUMMARY:Spring kickoff BBQ");
  expect(body).toContain("SUMMARY:Theme week: Costume week");
  expect(body).toContain("DTSTART;VALUE=DATE:20261026");
});

test("the events pages fit a phone screen without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/events", BBQ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
