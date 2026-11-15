import { beforeEach, describe, expect, it, vi } from "vitest";

const consume = vi.fn();
const demo = vi.fn();
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/queries/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consume(...args),
}));
vi.mock("@/lib/demo/guard", () => ({ demoStatus: () => demo() }));

import { allowPublicConcern } from "./contact-limits";

const NOW = new Date("2027-04-05T16:00:00Z");

beforeEach(() => {
  consume.mockReset().mockResolvedValue(true);
  demo.mockReset().mockReturnValue({ on: false });
});

describe("allowPublicConcern", () => {
  it("counts the network and everyone, and the address when one is given", async () => {
    expect(await allowPublicConcern("1.2.3.4", "a@example.test", NOW)).toBe(
      true,
    );
    expect(consume).toHaveBeenCalledTimes(3);
    await allowPublicConcern("1.2.3.4", null, NOW);
    expect(consume).toHaveBeenCalledTimes(5);
  });

  it("keeps addresses and networks out of the stored keys", async () => {
    await allowPublicConcern("1.2.3.4", "a@example.test", NOW);
    const keys = consume.mock.calls.map((c) => String(c[1]));
    expect(keys.join(" ")).not.toContain("a@example.test");
    expect(keys.join(" ")).not.toContain("1.2.3.4");
  });

  it("refuses when any one limit is over", async () => {
    consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await allowPublicConcern("1.2.3.4", null, NOW)).toBe(false);
  });

  it("does not limit the demo", async () => {
    demo.mockReturnValue({ on: true });
    expect(await allowPublicConcern("1.2.3.4", null, NOW)).toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });
});
