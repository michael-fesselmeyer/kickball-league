import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../support/axe";
import { type Persona, viewAs } from "../support/personas";

/**
 * Screens no flow walks through, checked with axe at a phone and a desktop
 * width in both themes. They only read data, so they are safe to run
 * alongside the flows.
 */
const SCREENS: [Persona, string, string][] = [
  ["Admin", "/operator", "Operator"],
  ["Admin", "/app/admin/audit", "Audit log"],
  [
    "Admin",
    "/app/admin/seasons/spring-2027/requests",
    "Team scheduling requests",
  ],
  ["Admin", "/app/admin/seasons/fall-2026/registrations", "Registrations"],
  ["Admin", "/app/admin/seasons/spring-2027/promo-codes", "Promo codes"],
  ["Admin", "/app/admin/seasons/fall-2026/playoffs", "Playoffs"],
  ["Captain", "/app/seasons/fall-2026/team/requests", "Scheduling requests"],
  ["Captain", "/app/seasons/fall-2026/team/subs", "Find subs"],
  ["Player", "/app/subs", "Sub for a team"],
];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const [persona, path, heading] of SCREENS) {
      test(`${path} is accessible to the ${persona.toLowerCase()}`, async ({
        page,
      }) => {
        await viewAs(page, persona);
        for (const width of [375, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            heading,
          );
          await expectNoAxeViolations(page);
          // Nothing but a table's own scroller may scroll sideways.
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            `${path} scrolls sideways at ${width}px`,
          ).toBe(true);
        }
      });
    }
  });
}
