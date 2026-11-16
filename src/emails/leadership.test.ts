import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });
const about = {
  seasonName: "Spring 2027",
  seasonSlug: "spring-2027",
  team: "Kick Bottom",
};
const page =
  "https://league.example.test/app/seasons/spring-2027/team/leadership";

const text = (
  kind: "leadership_check_in" | "leadership_result",
  payload: object,
) => {
  const result = render(kind, { ...about, ...payload });
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("leadership check-in emails", () => {
  it("opens with a positive question and links to the private page", () => {
    const email = text("leadership_check_in", {
      kind: "opened",
      closes: "Sunday, November 22",
    });
    expect(email.subject).toBe(
      "Who'd you like to help lead Kick Bottom next season?",
    );
    expect(email.text).toContain("Nobody sees your answer.");
    expect(email.text).toContain(page);
    expect(email.text).not.toMatch(/remove/i);
  });

  it("never says who suggested a teammate", () => {
    const email = text("leadership_check_in", {
      kind: "suggested",
      role: "captain",
    });
    expect(email.text).toContain("a teammate suggested you");
    expect(email.text).toContain("Saying no is completely fine");
  });

  it("tells the team only the outcome", () => {
    const changed = text("leadership_check_in", {
      kind: "outcome",
      outcome: "new_captain",
      elected: "Jo S.",
      when: "next_season",
    });
    expect(changed.text).toContain(
      "The team chose Jo S. as captain for next season.",
    );
    const kept = text("leadership_check_in", {
      kind: "outcome",
      outcome: "no_quorum",
    });
    expect(kept.text).toContain("nothing changes");
    expect(kept.text).not.toMatch(/\d+ (votes?|of)/);
  });

  it("tells the captain first, with the default if they don't choose", () => {
    const staying = text("leadership_result", {
      kind: "result",
      elected: "Jo S.",
      decideBy: "Wednesday, November 25",
      steppingDown: false,
    });
    expect(staying.subject).toBe(
      "Kick Bottom's leadership check-in: you hear first",
    );
    expect(staying.text).toContain(
      "the second happens on Wednesday, November 25",
    );
    const leaving = text("leadership_result", {
      kind: "result",
      elected: "Jo S.",
      decideBy: "Wednesday, November 25",
      steppingDown: true,
    });
    expect(leaving.text).toContain(
      "they're offered the captaincy on Wednesday",
    );
  });
});
