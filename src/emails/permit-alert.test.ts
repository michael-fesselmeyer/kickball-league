import { describe, expect, it } from "vitest";
import { rendererFor } from "./templates";

const render = rendererFor({ siteUrl: "https://league.example.test" });

const item = (n: number) => ({
  what: `Aces vs Bees ${n}`,
  when: "Tue, Sep 15, 7:00 PM",
  place: "Example Park, Field 3",
  why: "Field 3's permit for that time was marked lost.",
});

function email(count: number, items = [item(1)]) {
  const result = render("permit_alert", { kind: "uncovered", count, items });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("permit_alert: no longer covered (issue #407)", () => {
  it("lists what lost its permit and why, and links the permits", () => {
    const sent = email(1);
    expect(sent.subject).toBe(
      "A game or event is no longer covered by a permit",
    );
    expect(sent.text).toContain(
      "Aces vs Bees 1, Tue, Sep 15, 7:00 PM, Example Park, Field 3. Field 3's permit for that time was marked lost.",
    );
    expect(sent.text).toContain(
      "https://league.example.test/app/books/permits",
    );
    expect(sent.text).toContain("you are an owner of the league");
  });

  it("counts them all and says how many more are on the screen", () => {
    const sent = email(12, [item(1), item(2)]);
    expect(sent.subject).toBe(
      "12 games or events are no longer covered by a permit",
    );
    expect(sent.text).toContain("And 10 more on the permits screen.");
  });

  it("refuses an empty list", () => {
    expect(
      render("permit_alert", { kind: "uncovered", count: 1, items: [] }).ok,
    ).toBe(false);
  });
});
