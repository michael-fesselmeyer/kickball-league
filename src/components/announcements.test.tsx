// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnnouncementSummary } from "@/db/queries/announcements";
import type { AnnouncementId } from "@/domain/ids";
import { AnnouncementList } from "./announcements";

afterEach(cleanup);

const item: AnnouncementSummary = {
  id: "a1" as AnnouncementId,
  subject: "Jerseys are in",
  body: "Pick them up before Sunday's games.",
  teamSeasonId: null,
  createdAt: new Date("2026-11-01T15:00:00Z"),
  recipientCount: 12,
  delivery: { sent: 12 },
};

describe("AnnouncementList", () => {
  it("offers each announcement as one WhatsApp message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<AnnouncementList items={[item]} when={() => "Sun, Nov 1"} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy for WhatsApp: Jerseys are in",
      }),
    );
    expect(
      await screen.findByText("Copied. Paste it into the group chat."),
    ).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(
      "*Jerseys are in*\n\nPick them up before Sunday's games.",
    );
  });
});
