// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSnapshot } from "@/domain/scores/live";
import { LineScore, LiveLine } from "./line-score";
import { LiveScore } from "./live-score";

const NOW = new Date("2026-09-13T23:30:00Z");

const ON: LiveSnapshot = {
  kicksFirst: "A",
  halves: [
    { inning: 1, half: "top", runs: 2 },
    { inning: 1, half: "bottom", runs: 1 },
  ],
  closed: false,
  reported: false,
  pending: null,
  result: null,
  lastEntryAt: "2026-09-13T23:25:00Z",
};

const FINAL: LiveSnapshot = {
  ...ON,
  halves: [...ON.halves, { inning: 2, half: "top", runs: 3 }],
  closed: true,
  reported: true,
  result: { scoreA: 5, scoreB: 1, inningsPlayed: null },
  lastEntryAt: "2026-09-13T23:40:00Z",
};

const WINDOW = {
  pollFrom: "2026-09-13T22:30:00Z",
  pollUntil: "2026-09-14T03:00:00Z",
};

/** The run total in a team's row of the line score. */
const total = (team: string) =>
  screen.getByRole("row", { name: new RegExp(team) }).lastElementChild;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("winner moment", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
  });

  it("bursts the winner's total once when the result arrives while the page is open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(FINAL))),
    );
    render(
      <LiveScore
        gameId="g1"
        teamA="Sun Kickers"
        teamB="Red Rubber Ballers"
        initial={ON}
        {...WINDOW}
      />,
    );
    expect(total("Sun Kickers")).toHaveProperty("textContent", "2");
    expect(total("Sun Kickers")?.className).not.toContain("winner-burst");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(total("Sun Kickers")).toHaveProperty("textContent", "5");
    expect(total("Sun Kickers")?.className).toContain("winner-burst");
    expect(total("Red Rubber Ballers")?.className).not.toContain(
      "winner-burst",
    );
  });

  it("stays still on a page opened after the final", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(
      <LiveScore
        gameId="g1"
        teamA="Sun Kickers"
        teamB="Red Rubber Ballers"
        initial={FINAL}
        {...WINDOW}
      />,
    );
    expect(total("Sun Kickers")?.className).not.toContain("winner-burst");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("LineScore", () => {
  it("has no winner to celebrate after a tie", () => {
    render(
      <LineScore
        teamA="Sun Kickers"
        teamB="Red Rubber Ballers"
        snapshot={{
          ...FINAL,
          result: { scoreA: 4, scoreB: 4, inningsPlayed: null },
        }}
        celebrate
      />,
    );
    expect(document.querySelector(".winner-burst")).toBeNull();
  });
});

describe("a page copy from before the score", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
  });

  it("asks as soon as it loads, even outside the game's window", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(ON)));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(
      <LiveScore
        gameId="g1"
        teamA="Sun Kickers"
        teamB="Red Rubber Ballers"
        initial={null}
        pollFrom="2026-09-20T22:30:00Z"
        pollUntil="2026-09-21T03:00:00Z"
      />,
    );
    expect(container.innerHTML).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetch).toHaveBeenCalledWith("/api/games/g1/live");
    expect(total("Sun Kickers")).toHaveProperty("textContent", "2");
  });

  it("shows nothing while the game has no score yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    const { container } = render(
      <LiveScore
        gameId="g1"
        teamA="Sun Kickers"
        teamB="Red Rubber Ballers"
        initial={null}
        {...WINDOW}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("LiveLine", () => {
  it("marks the innings unofficial while the game is on", () => {
    render(<LiveLine teamA="Reds" teamB="Blues" snapshot={ON} />);
    expect(screen.getByText("Unofficial until final.")).toBeTruthy();
    expect(screen.queryByText(/Thanks to whoever kept score/)).toBeNull();
  });

  it("stays unofficial while a reported score waits for confirmation", () => {
    render(
      <LiveLine
        teamA="Reds"
        teamB="Blues"
        snapshot={{
          ...ON,
          reported: true,
          pending: { scoreA: 2, scoreB: 1, inningsPlayed: null },
        }}
      />,
    );
    expect(screen.getByText("Unofficial until final.")).toBeTruthy();
  });

  it("thanks the scorer once the score is final", () => {
    render(<LiveLine teamA="Reds" teamB="Blues" snapshot={FINAL} />);
    expect(screen.queryByText("Unofficial until final.")).toBeNull();
    expect(screen.getByText(/Thanks to whoever kept score/)).toBeTruthy();
  });
});
