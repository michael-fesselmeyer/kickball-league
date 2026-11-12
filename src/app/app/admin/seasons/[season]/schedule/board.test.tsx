// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameKey } from "@/domain/scheduler/types";
import { slotId } from "@/domain/scheduler/worked-example.fixture";
import { Board } from "./board";
import { boardSlots, input, schedule } from "./board.fixture";

const teams = Object.fromEntries(
  "ABCDEFGH".split("").map((id) => [id, `Team ${id}`]),
);

function renderBoard() {
  const save = vi.fn(async () => {});
  const view = render(
    <Board
      versionNo={3}
      input={input}
      schedule={schedule}
      slots={boardSlots()}
      teams={teams}
      save={save}
    />,
  );
  return { ...view, save };
}

const cell = (week: number, field: number, time: number) =>
  document.querySelector<HTMLElement>(
    `[data-slot="${slotId(week, field, time)}"] button`,
  )!;

const panel = () =>
  screen.getByRole("complementary", { name: "Effect of your changes" });

const editsField = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="edits"]')!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Board", () => {
  it("has no axe violations, idle or with a game held", async () => {
    const { container } = renderBoard();
    const rules = { "color-contrast": { enabled: false } };
    expect((await axe.run(container, { rules })).violations).toEqual([]);
    fireEvent.click(cell(0, 0, 0));
    fireEvent.focus(cell(1, 0, 2));
    expect((await axe.run(container, { rules })).violations).toEqual([]);
  });

  it("is one tab stop, with arrow keys between slots", () => {
    renderBoard();
    const tabbable = document.querySelectorAll('table [tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(cell(0, 0, 0));

    cell(0, 0, 0).focus();
    fireEvent.keyDown(cell(0, 0, 0), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(0, 1, 0));
    fireEvent.keyDown(cell(0, 1, 0), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(0, 1, 1));
    expect(cell(0, 1, 1).tabIndex).toBe(0);
    expect(cell(0, 0, 0).tabIndex).toBe(-1);
    fireEvent.keyDown(cell(0, 1, 1), { key: "End" });
    expect(document.activeElement).toBe(cell(6, 1, 2));
    fireEvent.keyDown(cell(6, 1, 2), { key: "Home" });
    expect(document.activeElement).toBe(cell(0, 1, 0));
  });

  it("moves a game with the keyboard and previews the effect first", () => {
    const { container } = renderBoard();
    const game = cell(0, 0, 0);
    expect(game.textContent).toContain("Team B vs Team G");

    fireEvent.click(game); // Enter or Space on a button
    expect(game.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toMatch(/Picked up/);

    // Week 2 already has a game for B, so this target breaks a hard rule.
    fireEvent.focus(cell(1, 0, 2));
    expect(within(panel()).getByText(/If you drop/)).toBeTruthy();
    expect(within(panel()).getByText(/new hard-rule problem/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/new problem/);

    // The empty slot beside it is fine.
    fireEvent.focus(cell(0, 1, 0));
    expect(
      within(panel()).getByText("No new hard-rule problems."),
    ).toBeTruthy();

    fireEvent.keyDown(cell(0, 1, 0), { key: "Enter" });
    expect(cell(0, 1, 0).textContent).toContain("Team B vs Team G");
    expect(document.activeElement).toBe(cell(0, 1, 0));
    expect(within(panel()).getByText("1 unsaved change")).toBeTruthy();
    expect(JSON.parse(editsField(container).value)).toEqual([
      {
        kind: "move",
        gameKey: gameKey(1, "B", "G"),
        slotId: slotId(0, 1, 0),
      },
    ]);
  });

  it("swaps with a game, undoes and discards", () => {
    const { container } = renderBoard();
    fireEvent.click(cell(0, 0, 0));
    fireEvent.click(cell(0, 0, 1));
    expect(cell(0, 0, 0).textContent).toContain("Team D vs Team E");
    expect(within(panel()).getByText(/Swapped Team B vs Team G/)).toBeTruthy();

    fireEvent.click(cell(0, 0, 0));
    fireEvent.click(cell(0, 1, 0));
    expect(within(panel()).getByText("2 unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(panel()).getByText("1 unsaved change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(within(panel()).getByText("No unsaved changes")).toBeTruthy();
    expect(editsField(container).value).toBe("[]");
    expect(
      screen.getByRole("button", { name: "Save as a new draft" }),
    ).toHaveProperty("disabled", true);
  });

  it("puts a held game back on Escape or a second press", () => {
    renderBoard();
    fireEvent.click(cell(0, 0, 0));
    fireEvent.focus(cell(0, 1, 0));
    fireEvent.keyDown(cell(0, 1, 0), { key: "Escape" });
    expect(cell(0, 0, 0).getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(cell(0, 0, 0));
    expect(screen.getByRole("status").textContent).toMatch(/Put back/);

    fireEvent.click(cell(0, 0, 0));
    fireEvent.click(cell(0, 0, 0));
    expect(cell(0, 0, 0).getAttribute("aria-pressed")).toBe("false");
    // An empty slot does nothing with no game held.
    fireEvent.click(cell(0, 1, 0));
    expect(within(panel()).getByText("No unsaved changes")).toBeTruthy();
  });

  it("drags a game with the pointer and shows the effect while dragging", () => {
    renderBoard();
    const game = cell(0, 0, 0);
    const target = cell(0, 1, 0);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    document.elementFromPoint = vi.fn(() => target);

    fireEvent.pointerDown(game, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(game, { pointerId: 1, clientX: 2, clientY: 0 });
    expect(game.getAttribute("aria-pressed")).toBe("false");
    fireEvent.pointerMove(game, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(game.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel()).getByText(/If you drop/)).toBeTruthy();

    fireEvent.pointerUp(game, { pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.click(game); // the click that ends a drag is ignored
    expect(cell(0, 1, 0).textContent).toContain("Team B vs Team G");
    expect(within(panel()).getByText("1 unsaved change")).toBeTruthy();
  });

  it("drops a drag released outside the board", () => {
    renderBoard();
    const game = cell(0, 0, 0);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    document.elementFromPoint = vi.fn(() => document.body);

    fireEvent.pointerDown(game, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(game, { pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(game, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(game.getAttribute("aria-pressed")).toBe("false");
    expect(within(panel()).getByText("No unsaved changes")).toBeTruthy();
  });
});
