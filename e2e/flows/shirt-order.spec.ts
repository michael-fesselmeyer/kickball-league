import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { type Member, memberPage } from "../support/people";
import { pageAs } from "../support/personas";
import { confirmAge, leagueDate, openSeason } from "../support/season";
import { download } from "../support/seed-data";
import { seasonTool } from "../support/app-nav";

/** A CSV file's lines; it opens with a byte-order mark so Excel reads UTF-8. */
function csvLines(text: string): string[] {
  expect(text.startsWith("﻿")).toBe(true);
  return text.slice(1).trimEnd().split("\r\n");
}

const SEASON = "Shirt Cup 2027";
const SLUG = "shirt-cup-2027";
const TEAM = "Tee Party";
const ORDER = `/app/admin/seasons/${SLUG}/shirt-order`;

const rowan: Member = {
  first: "Rowan",
  last: "Tee",
  email: "rowan.tee@example.test",
};
const quinn: Member = {
  first: "Quinn",
  last: "Sleeve",
  email: "quinn.sleeve@example.test",
};
const remy: Member = {
  first: "Remy",
  last: "Collar",
  email: "remy.collar@example.test",
};

/** The size picker inside a sign-up form, which starts at the profile's. */
const sizeIn = (scope: Page | ReturnType<Page["getByRole"]>) =>
  scope.getByRole("combobox", { name: "Shirt size", exact: true });

/**
 * The shirt order (product-spec.md, section 6). An admin offers XXXL this
 * season. Every way into a season asks for a shirt size and keeps it on
 * the profile: Rowan registers a team in L, Quinn joins it by invite link
 * in XXXL, and Remy joins the free-agent pool in S. The admin downloads the
 * vendor's CSV, with counts only and then with names for packing. Dropping
 * XXXL leaves Quinn without a size, and the reminder goes out once. The
 * admin places the order, adds its cost to the books in one tap and
 * receives it.
 */
test("sign-ups collect shirt sizes, and an admin orders the shirts from them", async ({
  browser,
}) => {
  // Four people sign in and several screens get an axe scan.
  test.slow();
  const admin = await pageAs(browser, "Admin");

  await test.step("the admin opens a season and offers XXXL too", async () => {
    await openSeason(admin, {
      name: SEASON,
      slug: SLUG,
      firstGameDay: leagueDate(40),
      lastGameDay: leagueDate(100),
      registrationCloses: leagueDate(30),
      teamFee: 600,
      freeAgentFee: 50,
      rosterMin: 8,
      rosterMax: 16,
    });
    await admin.goto(`/app/admin/seasons/${SLUG}`);
    await (await seasonTool(admin, "Shirt order")).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      "Shirt order",
    );
    await expectNoAxeViolations(admin);
    await admin.getByRole("checkbox", { name: "XXXL", exact: true }).check();
    await admin.getByRole("button", { name: "Save sizes" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Sizes saved. Sign-up forms offer these now.",
    );
    // The notice takes focus, so a screen reader reads it out, and the
    // totals row marks only its first cell as a header.
    await expect(admin.getByRole("status")).toBeFocused();
    await expect(
      admin
        .getByRole("table", { name: /Shirt sizes by team/ })
        .locator("tfoot th"),
    ).toHaveCount(1);
    await expectNoAxeViolations(admin);
  });

  let inviteLink = "";
  await test.step("a captain picks a size registering a team", async () => {
    const captain = await memberPage(browser, rowan);
    await captain.goto(`/app/seasons/${SLUG}/register`);
    const team = captain.getByRole("region", { name: "Register a team" });
    // The profile's size comes first; Rowan wants a bigger one this time.
    await expect(sizeIn(team)).toHaveValue("m");
    await sizeIn(team).selectOption({ label: "L" });
    await team.getByLabel("Team name").fill(TEAM);
    await team.getByLabel("Expected roster size").fill("10");
    await confirmAge(team);
    await expectNoAxeViolations(captain);
    await team.getByRole("button", { name: "Register the team" }).click();
    await expect(captain.getByRole("status")).toContainText(
      "Your team is registered",
    );
    await captain.goto("/app/profile");
    await expect(
      captain.getByRole("combobox", { name: "Shirt size" }),
    ).toHaveValue("l");

    await captain.goto(`/app/seasons/${SLUG}/team`);
    await captain.getByRole("button", { name: "Make an invite link" }).click();
    const link = captain.getByLabel("Your team's link");
    await expect(link).toHaveValue(/\/app\/join\//);
    inviteLink = await link.inputValue();
    await captain.context().close();
  });

  await test.step("a teammate picks a size joining by the invite link", async () => {
    const player = await memberPage(browser, quinn);
    await player.goto(new URL(inviteLink).pathname);
    await expectNoAxeViolations(player);
    await sizeIn(player).selectOption({ label: "XXXL" });
    await confirmAge(player);
    await player.getByRole("button", { name: `Join ${TEAM}` }).click();
    await expect(player.getByRole("status")).toHaveText(
      `You're on ${TEAM}. Next, sign the waiver.`,
    );
    await player.goto("/app/profile");
    await expect(
      player.getByRole("combobox", { name: "Shirt size" }),
    ).toHaveValue("xxxl");
    await player.context().close();
  });

  await test.step("a free agent picks a size joining the pool", async () => {
    const agent = await memberPage(browser, remy);
    await agent.goto(`/app/seasons/${SLUG}/register`);
    const pool = agent.getByRole("region", { name: "Or join on your own" });
    await sizeIn(pool).selectOption({ label: "S" });
    await confirmAge(pool);
    await pool.getByRole("button", { name: "Join as a free agent" }).click();
    await expect(agent.getByRole("status")).toContainText(
      "You're in the free-agent pool",
    );
    await agent.context().close();
  });

  await test.step("the admin downloads the vendor's CSV, names only when ticked", async () => {
    await admin.goto(ORDER);
    await expect(
      admin.getByRole("row", { name: new RegExp(`^${TEAM}`) }),
    ).toBeVisible();
    await expect(
      admin.getByRole("heading", { name: "Without a size (0)" }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);

    const button = admin.getByRole("button", {
      name: "Download for the vendor (CSV)",
    });
    const counts = await download(button);
    expect(counts.name).toMatch(/^shirt-cup-2027-shirt-order.*\.csv$/);
    const lines = csvLines(counts.text);
    expect(lines[0]).toBe("Item,Team,Team color,Size,Quantity");
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(new RegExp(`^Season shirt,${TEAM},[^,]*,L,1$`)),
      expect.stringMatching(new RegExp(`^Season shirt,${TEAM},[^,]*,XXXL,1$`)),
      "Season shirt,No team yet,,S,1",
    ]);
    expect(counts.text).not.toContain("Rowan");

    await admin.getByLabel("Include names for team packing").check();
    const named = await download(button);
    expect(named.name).toMatch(/with-names.*\.csv$/);
    const namedLines = csvLines(named.text);
    expect(namedLines[0]).toBe("Item,Team,Team color,Size,Quantity,Name");
    expect(named.text).toContain("Rowan Tee");
    expect(named.text).toContain("Quinn Sleeve");
    expect(named.text).toContain("Remy Collar");
  });

  await test.step("dropping a size leaves its player to remind, once", async () => {
    await admin.goto(ORDER);
    await admin.getByRole("checkbox", { name: "XXXL", exact: true }).uncheck();
    await admin.getByRole("button", { name: "Save sizes" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Sizes saved. Sign-up forms offer these now.",
    );
    const missing = admin.getByRole("region", { name: "Without a size (1)" });
    await expect(missing).toContainText("Quinn Sleeve");
    await missing
      .getByRole("button", { name: "Remind them to pick a size" })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Reminded 1 player to pick a size.",
    );
    await admin
      .getByRole("button", { name: "Remind them to pick a size" })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Nobody new to remind: everyone without a size has had a reminder.",
    );
  });

  await test.step("the admin places the order, books its cost and receives it", async () => {
    await admin.getByLabel("Cost in dollars (optional)").fill("412.50");
    await admin.getByLabel("Vendor (optional)").fill("Ink Co (demo)");
    await admin.getByRole("button", { name: "Mark the order placed" }).click();
    await expect(admin.getByRole("status")).toHaveText(
      "Order saved as placed. Players with a size are marked ordered.",
    );
    // Sizes are set once the vendor has the counts.
    await expect(
      admin.getByRole("checkbox", { name: "XL", exact: true }),
    ).toBeDisabled();
    await admin
      .getByRole("button", { name: "Add $412.50 to the books" })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Added to the books as a shirts expense.",
    );
    await expect(
      admin.getByText("In the books as a shirts expense."),
    ).toBeVisible();
    await admin
      .getByRole("button", { name: "Mark the order received" })
      .click();
    await expect(admin.getByRole("status")).toHaveText(
      "Order received. Every ordered shirt is marked received.",
    );
    await expect(
      admin.getByRole("heading", { name: "The order: Received" }),
    ).toBeVisible();
    await expectNoAxeViolations(admin);
  });
  await admin.context().close();
});
