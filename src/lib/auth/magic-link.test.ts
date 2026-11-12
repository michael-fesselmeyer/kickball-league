import { describe, expect, it, vi } from "vitest";
import { deliverMagicLink } from "./magic-link";

const link = {
  email: "player@example.com",
  url: "http://localhost:3000/api/auth/magic-link/verify?token=t",
};

describe("deliverMagicLink", () => {
  it("prints the link in development", () => {
    const log = vi.fn();
    deliverMagicLink(link, { nodeEnv: "development", log });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain(link.url);
  });

  it("refuses in production instead of logging a usable link", () => {
    const log = vi.fn();
    expect(() =>
      deliverMagicLink(link, { nodeEnv: "production", log }),
    ).toThrow(/not configured/);
    expect(log).not.toHaveBeenCalled();
  });
});
