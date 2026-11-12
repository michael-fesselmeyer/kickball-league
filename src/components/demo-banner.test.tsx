// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBanner } from "./demo-banner";

// The real action loads the auth server; the banner only needs a reference.
vi.mock("@/app/demo/actions", () => ({ viewAs: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("DemoBanner", () => {
  it("renders nothing with demo mode off", () => {
    vi.stubEnv("DEMO_MODE", "");
    const { container } = render(<DemoBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing, and says why on the server, when a safety check refuses", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://ci:ci@localhost:5432/kickball");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<DemoBanner />);
    expect(container.innerHTML).toBe("");
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/not a demo database/),
    );
    warn.mockRestore();
  });

  it("offers one tap to view as each role in demo mode", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://ci:ci@localhost:5432/kb_demo");
    render(<DemoBanner />);
    expect(screen.getByRole("complementary", { name: "Demo" })).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(
      buttons.map((b) => [b.textContent, b.getAttribute("value")]),
    ).toEqual([
      ["Player", "player"],
      ["Captain", "captain"],
      ["Ref", "ref"],
      ["Admin", "admin"],
    ]);
    for (const b of buttons) expect(b.getAttribute("name")).toBe("persona");
  });
});
