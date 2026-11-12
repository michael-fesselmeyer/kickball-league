// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyForWhatsApp, ShareButtons } from "./share";

const text =
  "Final: *Kickers 5, Sluggers 3*\nhttps://league.example.test/games/g1";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

function stubClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("ShareButtons", () => {
  it("links straight to WhatsApp with the message, no script needed", async () => {
    const { container } = render(<ShareButtons text={text} title="Game" />);
    const link = screen.getByRole("link", { name: /share on whatsapp/i });
    expect(link.getAttribute("href")).toBe(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
    );
    expect(link.getAttribute("rel")).toContain("noopener");
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it("uses the share sheet when the device has one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    render(<ShareButtons text={text} title="Game" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "More ways to share" }),
    );
    await vi.waitFor(() =>
      expect(share).toHaveBeenCalledWith({ title: "Game", text }),
    );
  });

  it("does nothing more when the share sheet is closed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("closed"), { name: "AbortError" }),
        ),
    });
    render(<ShareButtons text={text} title="Game" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "More ways to share" }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when the share sheet fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("not allowed")),
    });
    render(<ShareButtons text={text} title="Game" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "More ways to share" }),
    );
    expect(await screen.findByText(/copied/i)).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(text);
  });

  it("copies the message where there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<ShareButtons text={text} title="Game" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy the message" }));
    expect(
      await screen.findByText("Copied. Paste it into any chat."),
    ).toBeTruthy();
  });
});

describe("CopyForWhatsApp", () => {
  it("copies the message and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyForWhatsApp text={text} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for WhatsApp" }));
    expect(
      await screen.findByText("Copied. Paste it into the group chat."),
    ).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(text);
  });

  it("falls back to the older copy command without the Clipboard API", async () => {
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    render(<CopyForWhatsApp text={text} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for WhatsApp" }));
    expect(
      await screen.findByText("Copied. Paste it into the group chat."),
    ).toBeTruthy();
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("shows the message to copy by hand when copying fails", async () => {
    document.execCommand = vi.fn(() => {
      throw new Error("blocked");
    });
    render(<CopyForWhatsApp text={text} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy for WhatsApp" }));
    const box = await screen.findByRole("textbox", {
      name: /select the message/i,
    });
    expect((box as HTMLTextAreaElement).value).toBe(text);
  });
});
