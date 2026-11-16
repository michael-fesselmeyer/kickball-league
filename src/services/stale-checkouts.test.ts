import { describe, expect, it, vi } from "vitest";
import { closableCheckouts, type CheckoutSessions } from "./stale-checkouts";

const stale = (id: string) => ({ id, sessionId: `cs_${id}` });

function sessions(
  states: Record<string, "open" | "complete" | "expired" | "unreachable">,
): CheckoutSessions {
  return {
    expire: vi.fn(async (sessionId: string) => {
      const state = states[sessionId.slice(3)];
      // Stripe refuses to expire a session that is no longer open.
      if (state !== "open") throw new Error(`cannot expire ${state}`);
      // stripe-mock sends back a fixture that still says "open".
      return { id: sessionId, status: "open" as const };
    }),
    retrieve: vi.fn(async (sessionId: string) => {
      const state = states[sessionId.slice(3)];
      if (state === "unreachable") throw new Error("network");
      return { id: sessionId, status: state ?? null };
    }),
  };
}

describe("closableCheckouts: a second Pay never lets anyone pay twice", () => {
  it("closes checkouts Stripe expired, now or before", async () => {
    const result = await closableCheckouts(
      sessions({ a: "open", b: "expired" }),
      [stale("a"), stale("b")],
    );
    expect(result).toEqual({ close: ["a", "b"], state: "clear" });
  });

  it("keeps a checkout already paid open, so its payment still counts", async () => {
    // Paid in another tab; the webhook hasn't arrived yet.
    const result = await closableCheckouts(
      sessions({ a: "complete", b: "open" }),
      [stale("a"), stale("b")],
    );
    expect(result).toEqual({ close: ["b"], state: "paid" });
  });

  it("keeps a checkout it couldn't ask Stripe about, and says to try again", async () => {
    const result = await closableCheckouts(sessions({ a: "unreachable" }), [
      stale("a"),
    ]);
    expect(result).toEqual({ close: [], state: "unknown" });
  });

  it("has nothing to do without stale checkouts", async () => {
    const stripe = sessions({});
    expect(await closableCheckouts(stripe, [])).toEqual({
      close: [],
      state: "clear",
    });
    expect(stripe.expire).not.toHaveBeenCalled();
  });
});
