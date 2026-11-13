import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { completeProfile, pageAs } from "../support/personas";
import { download } from "../support/seed-data";

/**
 * The platform operator's switches for the whole site (ADR 0009). They
 * change what every visitor sees, so this file runs on its own after the
 * rest of the suite (`npm run test:e2e:site-wide`). The flows server treats
 * the demo admin as the operator (playwright.config.ts).
 *
 * Other server instances read the site's status from a short cache, so
 * checks on what visitors see reload until it shows (`toPass`), the way a
 * visitor would; nothing sleeps.
 */
test.describe.configure({ mode: "serial" });

async function setStatus(operator: Page, label: string) {
  await operator.goto("/operator");
  await operator
    .getByRole("radio", { name: new RegExp(`^${label}\\.`) })
    .check();
  await operator.getByRole("button", { name: "Save status" }).click();
  await expect(operator.getByRole("status")).toHaveText("Site status saved.");
  await expect(
    operator
      .getByRole("region", { name: "Site status" })
      .getByRole("strong")
      .first(),
  ).toHaveText(label);
}

/** Reloads `path` until `check` passes, as a visitor would. */
async function eventually(
  page: Page,
  path: string,
  check: () => Promise<void>,
) {
  await expect(async () => {
    await page.goto(path);
    await check();
  }).toPass();
}

test("read-only keeps everything visible but refuses changes", async ({
  browser,
}) => {
  const operator = await pageAs(browser, "Admin");
  // Signed in first: signing in is itself a change.
  const player = await pageAs(browser, "Player");
  const visitor = await (await browser.newContext()).newPage();

  await setStatus(operator, "Read-only");

  await eventually(visitor, "/seasons/fall-2026/standings", async () => {
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      "Standings",
    );
  });
  await eventually(player, "/app/profile", async () => {
    await player.getByRole("button", { name: "Save profile" }).click();
    await expect(player).toHaveURL(/\/paused$/);
  });
  await expect(player.getByRole("main")).toContainText(
    "site is read-only for now",
  );
  await expectNoAxeViolations(player);

  // The operator can still change things.
  await setStatus(operator, "Active");
  await expect(() => completeProfile(player)).toPass();
  await Promise.all(
    [operator, player, visitor].map((page) => page.context().close()),
  );
});

test("paused shows a notice to visitors while the operator can still export", async ({
  browser,
}) => {
  const operator = await pageAs(browser, "Admin");
  const visitor = await (await browser.newContext()).newPage();

  await setStatus(operator, "Paused");
  await eventually(visitor, "/", async () => {
    await expect(visitor.getByRole("main")).toContainText(
      "site is paused for now",
    );
  });
  await expect(
    visitor.getByRole("link", { name: "Sign in" }).first(),
  ).toBeVisible();
  await expectNoAxeViolations(visitor);

  // The league's data never waits on the operator.
  await operator.goto("/operator");
  const exported = await download(
    operator.getByRole("link", { name: "Download the league export" }),
  );
  expect(JSON.parse(exported.text)).toHaveProperty("seasons");

  await setStatus(operator, "Active");
  await eventually(visitor, "/", async () => {
    await expect(visitor.getByRole("main")).not.toContainText(
      "site is paused for now",
    );
    await expect(
      visitor.getByRole("link", { name: "Sign up for a season" }),
    ).toBeVisible();
  });
  await Promise.all([operator, visitor].map((page) => page.context().close()));
});

test("a feature switched off disappears until it is switched back on", async ({
  browser,
}) => {
  const operator = await pageAs(browser, "Admin");
  const player = await pageAs(browser, "Player");

  await operator.goto("/operator");
  const features = operator.getByRole("region", { name: "Features" });
  await features.getByRole("button", { name: /^Turn off sub finder/i }).click();
  await expect(operator.getByRole("status")).toHaveText(
    "Feature switch saved.",
  );
  await expect(features).toContainText("Sub finder: off");
  await eventually(player, "/app/subs", async () => {
    await expect(player.getByRole("heading", { level: 1 })).not.toHaveText(
      "Sub for a team",
    );
  });

  await features.getByRole("button", { name: /^Turn on sub finder/i }).click();
  await expect(operator.getByRole("status")).toHaveText(
    "Feature switch saved.",
  );
  await expect(features).toContainText("Sub finder: on");
  await eventually(player, "/app/subs", async () => {
    await expect(player.getByRole("heading", { level: 1 })).toHaveText(
      "Sub for a team",
    );
  });

  // Every switch is in the audit log, under the operator's own filter.
  await operator.goto("/app/admin/audit?only=operator");
  await expect(
    operator.getByText("Platform operator changed the site status").first(),
  ).toBeVisible();
  await expect(
    operator.getByText("Platform operator switched a feature").first(),
  ).toBeVisible();
  await Promise.all([operator, player].map((page) => page.context().close()));
});
