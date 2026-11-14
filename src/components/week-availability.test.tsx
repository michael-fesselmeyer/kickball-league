// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { availabilityFor, type Member } from "@/domain/availability/away";
import { WeekAvailabilityNote } from "./week-availability";

afterEach(cleanup);

const WEEK = "2026-10-05";
const roster: Member[] = [
  ...["Ana", "Bea", "Cy", "Di", "Eve", "Flo"].map((name) => ({
    userId: name,
    name,
    side: "woman" as const,
  })),
  ...["Gus", "Hal", "Ike", "Jon", "Kai", "Lou"].map((name) => ({
    userId: name,
    name,
    side: "man" as const,
  })),
];
const away = (...names: string[]) =>
  availabilityFor(
    roster,
    new Map(names.map((n) => [n, new Set([WEEK])])),
    WEEK,
  );
const SUBS = "/app/seasons/fall-2026/team/subs?game=g1#ask";

describe("WeekAvailabilityNote", () => {
  it("prompts a captain with a one-tap link when the week is short", () => {
    render(
      <WeekAvailabilityNote
        week={away("Ana", "Bea")}
        captain
        subsHref={SUBS}
      />,
    );
    expect(
      screen.getByText(/10 available that week · away: Ana, Bea/),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Ask for a sub" }).getAttribute("href"),
    ).toBe(SUBS);
  });

  it("says why when there is no link", () => {
    render(
      <WeekAvailabilityNote
        week={away("Ana", "Bea")}
        captain
        subsHref={null}
        noSubs="Sub requests close when the game starts."
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText(/Sub requests close when the game starts\./),
    ).toBeTruthy();
  });

  it("shows players a count, never who is away, and no prompt", () => {
    render(
      <WeekAvailabilityNote
        week={away("Ana", "Bea")}
        captain={false}
        subsHref={SUBS}
      />,
    );
    expect(screen.getByText("10 available that week · 2 away")).toBeTruthy();
    expect(screen.queryByText(/Ana/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("stays quiet for a captain when the week is full", () => {
    render(<WeekAvailabilityNote week={away("Ana")} captain subsHref={SUBS} />);
    expect(screen.getByText("11 available that week · away: Ana")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
