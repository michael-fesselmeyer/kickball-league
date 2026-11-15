import { describe, expect, it } from "vitest";
import { winBackMessage } from "@/domain/win-back/win-back";
import { winBackEmail } from "./win-back";

const context = { siteUrl: "https://league.example.test" };

describe("winBackEmail", () => {
  it("renders the league's filled-in wording with its button", () => {
    const rendered = winBackEmail(
      winBackMessage(
        { subject: "Back for {season}?", body: "Hi {first_name}\n\nSee you" },
        { firstName: "Robin", lastTeam: "Sun Kickers", lastRole: "captain" },
        { name: "Spring 2027", slug: "spring-2027" },
      ),
      context,
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.subject).toBe("Back for Spring 2027?");
    expect(rendered.value.html).toContain("Hi Robin");
    expect(rendered.value.html).toContain(
      "https://league.example.test/app/seasons/spring-2027/register",
    );
  });

  it("sends a subject swollen by long names, cut to fit", () => {
    const long = "x".repeat(120);
    const rendered = winBackEmail(
      winBackMessage(
        { subject: "{first_name} {team} {season}", body: "Hi" },
        { firstName: long, lastTeam: long, lastRole: "player" },
        { name: long, slug: "spring-2027" },
      ),
      context,
    );
    expect(rendered.ok).toBe(true);
  });

  it("refuses a payload that isn't one", () => {
    expect(winBackEmail({ subject: "Hi" }, context).ok).toBe(false);
  });
});
