import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { pageAs } from "../support/personas";

/**
 * A member lowers their daily limit, picks a weekly digest and moves their
 * quiet hours on the profile page; the choices stay after a reload. Quiet
 * hours that start and end at the same time are refused.
 */
test("a member sets their daily limit, digest and quiet hours", async ({
  browser,
}) => {
  const page = await pageAs(browser, "Ref");
  await page.goto("/app/profile");
  const section = page.getByRole("region", {
    name: "How often we message you",
  });
  await expect(section).toBeVisible();

  const cap = section.getByLabel("Daily limit for news and reminders");
  const weekly = section.getByLabel("Sundays at 6 pm");
  const quiet = section.getByLabel("Hold news and reminders overnight");
  const from = section.getByLabel("From");
  const until = section.getByLabel("Until");

  // The defaults: 3 a day, a daily digest, quiet from 10 pm to 8 am.
  await expect(cap).toHaveValue("3");
  await expect(section.getByLabel("Every evening at 6 pm")).toBeChecked();
  await expect(quiet).toBeChecked();
  await expect(from).toHaveValue("22");
  await expect(until).toHaveValue("8");
  await section.getByText("What always comes right away").click();
  await expect(section.getByText("Rain-outs and makeup times")).toBeVisible();
  await expectNoAxeViolations(page);

  await cap.selectOption({ label: "1 message a day" });
  await weekly.check();
  await from.selectOption({ label: "11 pm" });
  await until.selectOption({ label: "7 am" });
  await section.getByRole("button", { name: "Save message limits" }).click();
  await expect(page).toHaveURL(/\/app\/profile\?alerts=saved#alert-limits$/);
  await expect(section.getByRole("status")).toHaveText("Message limits saved.");
  await expectNoAxeViolations(page);

  await page.reload();
  await expect(cap).toHaveValue("1");
  await expect(weekly).toBeChecked();
  await expect(from).toHaveValue("23");
  await expect(until).toHaveValue("7");

  await until.selectOption({ label: "11 pm" });
  await section.getByRole("button", { name: "Save message limits" }).click();
  await expect(page).toHaveURL(/alerts=invalid/);
  await expect(section.getByRole("alert")).toHaveText(
    "Quiet hours need different start and end times.",
  );
  await expectNoAxeViolations(page);

  // Turning quiet hours off is always allowed.
  await quiet.uncheck();
  await section.getByRole("button", { name: "Save message limits" }).click();
  await expect(page).toHaveURL(/alerts=saved/);
  await expect(quiet).not.toBeChecked();
  await page.context().close();
});
