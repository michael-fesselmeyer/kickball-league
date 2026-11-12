// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { badgeFill, inkFor } from "@/domain/badge/badge";
import { LogoBadge } from "./logo-badge";

afterEach(cleanup);

/** axe in jsdom. Color contrast needs real layout, so it is covered by the token tests instead. */
async function axeViolations(container: HTMLElement) {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

describe("LogoBadge", () => {
  it("draws a team placeholder with initials, a stable fill and readable ink", () => {
    render(<LogoBadge kind="team" name="The Big Kicks" />);
    const badge = screen.getByRole("img", { name: "The Big Kicks logo" });
    expect(badge.textContent).toBe("TB");
    const fill = badgeFill("The Big Kicks");
    expect(badge.querySelector("circle")?.getAttribute("fill")).toBe(fill);
    expect(badge.querySelector("text")?.getAttribute("fill")).toBe(
      inkFor(fill),
    );
  });

  it("uses the team's chosen color when it has one", () => {
    render(<LogoBadge kind="team" name="Sun Kickers" color="#F5B301" />);
    const badge = screen.getByRole("img", { name: "Sun Kickers logo" });
    expect(badge.querySelector("circle")?.getAttribute("fill")).toBe("#F5B301");
    expect(badge.querySelector("text")?.getAttribute("fill")).toBe("#14182B");
  });

  it("draws the league pennant with up to three initials", () => {
    render(<LogoBadge kind="league" name="Brooklyn Kickball Club" />);
    expect(
      screen.getByRole("img", { name: "Brooklyn Kickball Club logo" })
        .textContent,
    ).toBe("BKC");
  });

  it("labels an avatar with the person's name", () => {
    render(<LogoBadge kind="avatar" name="Jordan Rivera" />);
    expect(screen.getByRole("img", { name: "Jordan Rivera" }).textContent).toBe(
      "JR",
    );
  });

  it("shows the uploaded image instead of a placeholder, at the same size", () => {
    render(
      <LogoBadge
        kind="team"
        name="The Big Kicks"
        src="/logos/big-kicks.png"
        size={64}
      />,
    );
    const img = screen.getByRole("img", { name: "The Big Kicks logo" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/logos/big-kicks.png");
    expect(img.getAttribute("width")).toBe("64");
  });

  it.each([24, 40, 64, 96, 160] as const)("renders at %ipx", (size) => {
    render(<LogoBadge kind="team" name="Any Team" size={size} />);
    expect(screen.getByRole("img").getAttribute("width")).toBe(String(size));
  });

  it("has no accessibility violations in any form", async () => {
    const { container } = render(
      <main>
        <LogoBadge kind="team" name="The Big Kicks" />
        <LogoBadge kind="team" name="Sun Kickers" src="/logos/sun.png" />
        <LogoBadge kind="league" name="Brooklyn Kickball Club" />
        <LogoBadge kind="avatar" name="Jordan Rivera" />
      </main>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
