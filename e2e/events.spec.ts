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
  // A played day: the rain-out flow may cancel the last one (Costume week's).
  const day = page.getByRole("region", { name: "Tuesday, September 29" });
  await expect(
    day.getByRole("link", { name: "Theme week: Neon week" }),
  ).toHaveAttribute("href", "/events/neon-week-2026-09-28");
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

test("a members-only event stays off every public page and feed", async ({
  page,
  request,
}) => {
  // The seeded Spring prom is for members (src/seed/event-audience.ts).
  await page.goto("/events");
  await expect(
    page.getByRole("link", { name: /Spring kickoff BBQ/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Spring prom/ })).toHaveCount(0);
  await page.goto("/events/spring-prom-2027-03-20");
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  const feed = await (await request.get("/events/calendar.ics")).text();
  expect(feed).not.toContain("Spring prom");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/events/spring-kickoff-bbq-2027-04-10");
  expect(sitemap).not.toContain("spring-prom");
});
