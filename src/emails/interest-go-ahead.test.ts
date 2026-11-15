import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

describe("the interest go-ahead message", () => {
  it("names the option, keeps the league's note and says why it was sent", () => {
    const result = render("interest_go_ahead", {
      leagueName: "Example Kickball",
      optionLabel: "Thursday nights · Social · Prospect Park",
      note: "Registration opens in January.",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subject).toBe(
      "Thursday nights · Social · Prospect Park is going ahead",
    );
    expect(result.value.text).toContain("Registration opens in January.");
    expect(result.value.text).toContain(
      "you answered Example Kickball's interest form",
    );
    // No account, so no link to account settings.
    expect(result.value.text).not.toContain("/app/profile");
    expect(result.value.text).toContain("https://league.example.test/contact");
  });

  it("leaves the note out when the league wrote none", () => {
    const result = render("interest_go_ahead", {
      leagueName: "Example Kickball",
      optionLabel: "Friday nights",
      note: "",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text).not.toMatch(/\n\n\n/);
  });

  it("escapes the league's words in the HTML", () => {
    const result = render("interest_go_ahead", {
      leagueName: "Example Kickball",
      optionLabel: "Fort <b>Greene</b>",
      note: "",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.html).not.toContain("<b>Greene");
  });

  it("refuses a payload with no option", () => {
    expect(render("interest_go_ahead", { leagueName: "x", note: "" }).ok).toBe(
      false,
    );
  });
});
