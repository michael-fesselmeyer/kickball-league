import { beforeEach, describe, expect, it, vi } from "vitest";

const consume = vi.fn();
const demo = vi.fn();
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consume(...args),
}));
vi.mock("@/lib/demo/guard", () => ({ demoStatus: () => demo() }));

import { allowInterestAnswer } from "./interest-limits";

const NOW = new Date("2027-04-05T16:00:00Z");

beforeEach(() => {
  consume.mockReset().mockResolvedValue(true);
  demo.mockReset().mockReturnValue({ on: false });
});

describe("allowInterestAnswer", () => {
  it("counts the address, the network and everyone", async () => {
    expect(await allowInterestAnswer("1.2.3.4", "a@example.test", NOW)).toBe(
      true,
    );
    expect(consume).toHaveBeenCalledTimes(3);
  });

  it("keeps addresses and networks out of the stored keys", async () => {
    await allowInterestAnswer("1.2.3.4", "a@example.test", NOW);
    const keys = consume.mock.calls.map((c) => String(c[1])).join(" ");
    expect(keys).not.toContain("a@example.test");
    expect(keys).not.toContain("1.2.3.4");
    expect(keys).toContain("interest:");
  });

  it("refuses when any one limit is over", async () => {
    consume
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await allowInterestAnswer("1.2.3.4", "a@example.test", NOW)).toBe(
      false,
    );
  });

  it("does not limit the demo", async () => {
    demo.mockReturnValue({ on: true });
    expect(await allowInterestAnswer("1.2.3.4", "a@example.test", NOW)).toBe(
      true,
    );
    expect(consume).not.toHaveBeenCalled();
  });
});
