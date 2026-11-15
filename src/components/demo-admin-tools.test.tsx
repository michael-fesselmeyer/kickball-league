// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoTools } from "@/app/demo/actions";
import { DemoAdminTools } from "./demo-admin-tools";

vi.mock("@/app/demo/actions", () => ({
  demoTools: vi.fn(),
  resetDemo: vi.fn(),
}));

afterEach(cleanup);

describe("DemoAdminTools", () => {
  it("shows nothing to anyone but an admin", async () => {
    vi.mocked(demoTools).mockResolvedValue({ mail: false, reset: false });
    const { container } = render(<DemoAdminTools />);
    await vi.waitFor(() => expect(demoTools).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("gives an admin the demo's mail, and no reset where it can't run", async () => {
    vi.mocked(demoTools).mockResolvedValue({ mail: true, reset: false });
    render(<DemoAdminTools />);
    const mail = await screen.findByRole("link", { name: "Demo mail" });
    expect(mail.getAttribute("href")).toBe("/app/admin/demo-mail");
    expect(screen.queryByRole("button", { name: "Reset demo" })).toBeNull();
  });

  it("asks before resetting, and can be called off", async () => {
    vi.mocked(demoTools).mockResolvedValue({ mail: true, reset: true });
    render(<DemoAdminTools />);
    fireEvent.click(await screen.findByRole("button", { name: "Reset demo" }));
    const yes = screen.getByRole("button", { name: "Yes, reset" });
    expect(yes.getAttribute("type")).toBe("submit");
    expect(screen.getByText(/everyone is signed out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.getByRole("button", { name: "Reset demo" })).toBeTruthy();
  });
});
