import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
const transaction = vi.fn(async (fn: (tx: object) => unknown) => fn({}));
const placeMerchOrder = vi.fn();
const merchCheckout = vi.fn();
const expirePurchases = vi.fn();
const retrieve = vi.fn();
const expire = vi.fn();
const create = vi.fn();

vi.mock("next/navigation", () => ({
  redirect,
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("@/db/client", () => ({ db: {}, txDb: { transaction } }));
vi.mock("@/db/queries/event-audience", () => ({
  viewerOf: vi.fn(async () => ({ member: true })),
}));
vi.mock("@/db/queries/merch", () => ({ placeMerchOrder, merchCheckout }));
vi.mock("@/db/queries/payments", () => ({
  attachCheckoutSession: vi.fn(),
  expirePurchases,
}));
vi.mock("@/db/queries/profile", () => ({ profileOf: vi.fn(async () => null) }));
vi.mock("@/domain/authz/permissions", () => ({ can: vi.fn(() => false) }));
vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://league.example.test" },
}));
vi.mock("@/lib/auth/permission", () => ({
  requirePermissionToChange: vi.fn(async () => ({ userId: "u" })),
}));
vi.mock("@/lib/demo/checkout", () => ({
  checkoutPage: vi.fn((session: { url: string | null }) => session.url),
}));
vi.mock("@/services/outbox", () => ({ sendQueuedSoon: vi.fn() }));
vi.mock("@/services/stripe", () => ({
  stripeClient: vi.fn(() => ({
    checkout: { sessions: { retrieve, expire, create } },
  })),
}));
vi.mock("@/lib/log-error", () => ({ logError: vi.fn() }));
vi.mock("@/lib/action-limit", () => ({ allowAction: vi.fn(async () => true) }));
vi.mock("@/lib/league/active", () => ({
  activeLeague: vi.fn(async () => ({ id: "l" })),
}));

const itemId = "11111111-1111-4111-8111-111111111111";
const page = `/app/shop/${itemId}`;
const openCheckout = {
  ok: true,
  value: { kind: "open_checkout", purchaseId: "p1" },
} as const;

async function order() {
  const { orderMerchAction } = await import("./actions");
  return orderMerchAction(itemId, new FormData());
}

describe("orderMerchAction: back for a checkout left open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchCheckout.mockResolvedValue({ sessionId: "cs_1", status: "open" });
  });

  it("goes back to the checkout while Stripe still takes payment", async () => {
    placeMerchOrder.mockResolvedValue(openCheckout);
    retrieve.mockResolvedValue({
      id: "cs_1",
      status: "open",
      url: "https://checkout.example.test/cs_1",
    });
    await expect(order()).rejects.toThrow(
      "redirect:https://checkout.example.test/cs_1",
    );
    expect(expirePurchases).not.toHaveBeenCalled();
  });

  it("sends a paid checkout to the paid order and keeps its stock", async () => {
    placeMerchOrder.mockResolvedValue(openCheckout);
    retrieve.mockResolvedValue({ id: "cs_1", status: "complete", url: null });
    expire.mockRejectedValue(new Error("already complete"));
    await expect(order()).rejects.toThrow("redirect:/app/shop?order=paid");
    expect(expirePurchases).not.toHaveBeenCalled();
  });

  it("keeps the stock and credit when Stripe can't be reached", async () => {
    placeMerchOrder.mockResolvedValue(openCheckout);
    retrieve.mockRejectedValue(new Error("network"));
    expire.mockRejectedValue(new Error("network"));
    await expect(order()).rejects.toThrow(
      `redirect:${page}?error=checkout_unknown`,
    );
    expect(expirePurchases).not.toHaveBeenCalled();
    expect(placeMerchOrder).toHaveBeenCalledTimes(1);
  });

  it("gives back an expired checkout's hold and places the order again", async () => {
    placeMerchOrder
      .mockResolvedValueOnce(openCheckout)
      .mockResolvedValueOnce({ ok: false, error: "sold_out" });
    retrieve.mockResolvedValue({ id: "cs_1", status: "expired", url: null });
    expire.mockRejectedValue(new Error("already expired"));
    await expect(order()).rejects.toThrow(`redirect:${page}?error=sold_out`);
    expect(expirePurchases).toHaveBeenCalledWith({}, ["p1"]);
    expect(placeMerchOrder).toHaveBeenCalledTimes(2);
  });
});
