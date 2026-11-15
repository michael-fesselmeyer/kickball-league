import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  planGuarantees: vi.fn(),
  chargesToSend: vi.fn(),
  failCharge: vi.fn(),
  recordChargeIntent: vi.fn(),
  stripeClient: vi.fn(),
  chargeSavedCard: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  txDb: { transaction: (fn: (tx: unknown) => unknown) => fn("tx") },
}));
vi.mock("@/db/queries/guarantee", () => m);
vi.mock("@/services/stripe", () => ({ stripeClient: m.stripeClient }));
vi.mock("@/services/stripe-guarantee", () => ({
  chargeSavedCard: m.chargeSavedCard,
}));
vi.mock("@/lib/log-error", () => ({ logError: m.logError }));

const { runGuaranteeCharges } = await import("./guarantee-charges");
const now = new Date("2027-03-01T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.planGuarantees.mockResolvedValue({ warned: 2 });
  m.stripeClient.mockReturnValue({});
});

describe("runGuaranteeCharges", () => {
  it("sends warnings but makes no charge when Stripe is not configured", async () => {
    m.stripeClient.mockReturnValue(null);
    expect(await runGuaranteeCharges(now)).toEqual({
      warned: 2,
      charged: 0,
      declined: 0,
      retry: 0,
    });
    expect(m.chargesToSend).not.toHaveBeenCalled();
  });

  it("records each taken charge's intent and counts it", async () => {
    m.chargesToSend.mockResolvedValue([
      { purchaseId: "p1" },
      { purchaseId: "p2" },
    ]);
    m.chargeSavedCard.mockResolvedValue({ ok: true, intentId: "pi_1" });
    const run = await runGuaranteeCharges(now);
    expect(run).toMatchObject({ charged: 2, declined: 0, retry: 0 });
    expect(m.recordChargeIntent).toHaveBeenCalledWith(
      expect.anything(),
      "p1",
      "pi_1",
    );
    expect(m.failCharge).not.toHaveBeenCalled();
  });

  it("fails a declined charge, keeping its intent when Stripe made one", async () => {
    m.chargesToSend.mockResolvedValue([
      { purchaseId: "p1" },
      { purchaseId: "p2" },
    ]);
    m.chargeSavedCard
      .mockResolvedValueOnce({ ok: false, declined: true, intentId: "pi_d" })
      .mockResolvedValueOnce({ ok: false, declined: true, intentId: null });
    const run = await runGuaranteeCharges(now);
    expect(run.declined).toBe(2);
    expect(m.recordChargeIntent).toHaveBeenCalledTimes(1);
    expect(m.recordChargeIntent).toHaveBeenCalledWith("tx", "p1", "pi_d");
    expect(m.failCharge).toHaveBeenCalledWith("tx", "p1", now);
    expect(m.failCharge).toHaveBeenCalledWith("tx", "p2", now);
  });

  it("counts a Stripe error for a retry and carries on with the next charge", async () => {
    m.chargesToSend.mockResolvedValue([
      { purchaseId: "p1" },
      { purchaseId: "p2" },
    ]);
    m.chargeSavedCard
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, intentId: "pi_2" });
    const run = await runGuaranteeCharges(now);
    expect(run).toMatchObject({ charged: 1, retry: 1, declined: 0 });
    expect(m.logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Error),
      "p1",
    );
    expect(m.failCharge).not.toHaveBeenCalled();
  });
});
