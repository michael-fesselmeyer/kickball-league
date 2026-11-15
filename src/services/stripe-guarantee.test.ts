import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { ChargeToSend } from "@/db/queries/guarantee";
import { parseId } from "@/domain/ids";
import type { PurchaseId } from "@/domain/ids";
import {
  chargeSavedCard,
  ensureCustomer,
  stripeEventExtras,
} from "./stripe-guarantee";

/**
 * The real Stripe SDK against a fake network: each call is answered from a
 * table of path to reply, and every request is recorded.
 */
type Reply = { status?: number; body: unknown };
type Seen = {
  path: string;
  form: URLSearchParams;
  idempotencyKey: string | null;
};

function stripeAnswering(replies: Record<string, Reply>) {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    seen.push({
      path: url.pathname,
      form: new URLSearchParams(String(init?.body ?? "")),
      idempotencyKey: headers.get("idempotency-key"),
    });
    const reply = replies[url.pathname];
    if (!reply) throw new Error(`Unexpected Stripe call: ${url.pathname}`);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  const stripe = new Stripe("sk_test_unit", {
    httpClient: Stripe.createFetchHttpClient(fetchFn),
    maxNetworkRetries: 0,
  });
  return { stripe, seen };
}

describe("ensureCustomer", () => {
  it("reuses a customer that already exists without calling Stripe", async () => {
    const { stripe, seen } = stripeAnswering({});
    const id = await ensureCustomer(stripe, {
      userId: "u1",
      email: "pat@example.test",
      existing: "cus_old",
    });
    expect(id).toBe("cus_old");
    expect(seen).toHaveLength(0);
  });

  it("makes one with the person as the idempotency key", async () => {
    const { stripe, seen } = stripeAnswering({
      "/v1/customers": { body: { id: "cus_new", object: "customer" } },
    });
    const id = await ensureCustomer(stripe, {
      userId: "u1",
      email: "pat@example.test",
      existing: null,
    });
    expect(id).toBe("cus_new");
    expect(seen[0]?.idempotencyKey).toBe("customer-u1");
    expect(seen[0]?.form.get("metadata[userId]")).toBe("u1");
  });
});

describe("stripeEventExtras", () => {
  const setupSession = (over: Record<string, unknown> = {}) => ({
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "setup",
        metadata: { kind: "guarantee" },
        setup_intent: "seti_1",
        customer: "cus_1",
        ...over,
      },
    },
  });
  const card = {
    "/v1/payment_methods/pm_1": {
      body: {
        id: "pm_1",
        object: "payment_method",
        card: { brand: "visa", last4: "4242" },
      },
    },
  };

  it("ignores events that are not a guarantee card setup, without calling Stripe", async () => {
    const { stripe, seen } = stripeAnswering({});
    expect(
      await stripeEventExtras(stripe, {
        id: "e",
        type: "charge.refunded",
        data: {},
      }),
    ).toEqual({});
    expect(
      await stripeEventExtras(stripe, setupSession({ mode: "payment" })),
    ).toEqual({});
    expect(
      await stripeEventExtras(
        stripe,
        setupSession({ metadata: { kind: "registration" } }),
      ),
    ).toEqual({});
    expect(
      await stripeEventExtras(stripe, {
        id: "e",
        type: "checkout.session.completed",
        data: {},
      }),
    ).toEqual({});
    expect(seen).toHaveLength(0);
  });

  it("looks up the saved card's brand and last four", async () => {
    const { stripe } = stripeAnswering({
      "/v1/setup_intents/seti_1": {
        body: {
          id: "seti_1",
          object: "setup_intent",
          payment_method: "pm_1",
          customer: "cus_9",
        },
      },
      ...card,
    });
    expect(await stripeEventExtras(stripe, setupSession())).toEqual({
      setup: {
        customerId: "cus_9",
        paymentMethodId: "pm_1",
        brand: "visa",
        last4: "4242",
      },
    });
  });

  it("falls back to the session's customer, and to empty card details", async () => {
    const { stripe } = stripeAnswering({
      "/v1/setup_intents/seti_1": {
        body: {
          id: "seti_1",
          object: "setup_intent",
          payment_method: { id: "pm_1" },
          customer: null,
        },
      },
      "/v1/payment_methods/pm_1": {
        body: { id: "pm_1", object: "payment_method" },
      },
    });
    expect(await stripeEventExtras(stripe, setupSession())).toEqual({
      setup: {
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        brand: null,
        last4: null,
      },
    });
  });

  it("uses an expanded SetupIntent without fetching it again", async () => {
    const { stripe, seen } = stripeAnswering(card);
    const expanded = {
      id: "seti_1",
      payment_method: "pm_1",
      customer: "cus_3",
    };
    const r = await stripeEventExtras(
      stripe,
      setupSession({ setup_intent: expanded }),
    );
    expect(seen.map((s) => s.path)).toEqual(["/v1/payment_methods/pm_1"]);
    expect(r.setup?.customerId).toBe("cus_3");
  });

  it("throws, so Stripe sends the webhook again, when it cannot say which card", async () => {
    await expect(
      stripeEventExtras(
        stripeAnswering({}).stripe,
        setupSession({ setup_intent: null }),
      ),
    ).rejects.toThrow("without a SetupIntent");
    const noCard = stripeAnswering({
      "/v1/setup_intents/seti_1": {
        body: {
          id: "seti_1",
          object: "setup_intent",
          payment_method: null,
          customer: "c",
        },
      },
    });
    await expect(
      stripeEventExtras(noCard.stripe, setupSession()),
    ).rejects.toThrow("without a card or customer");
    const noCustomer = stripeAnswering({
      "/v1/setup_intents/seti_1": {
        body: {
          id: "seti_1",
          object: "setup_intent",
          payment_method: "pm_1",
          customer: null,
        },
      },
    });
    await expect(
      stripeEventExtras(noCustomer.stripe, setupSession({ customer: null })),
    ).rejects.toThrow("without a card or customer");
  });
});

describe("chargeSavedCard", () => {
  const purchaseId = parseId<PurchaseId>(
    "0b6f0b3e-6c47-4a58-9a5e-2a4a6a0c1d11",
  );
  if (!purchaseId) throw new Error("fixture id is not a UUID");
  const charge: ChargeToSend = {
    purchaseId,
    cents: 4200,
    customerId: "cus_1",
    paymentMethodId: "pm_1",
  };

  it("charges off-session with the purchase as the idempotency key", async () => {
    const { stripe, seen } = stripeAnswering({
      "/v1/payment_intents": { body: { id: "pi_1", object: "payment_intent" } },
    });
    expect(await chargeSavedCard(stripe, charge)).toEqual({
      ok: true,
      intentId: "pi_1",
    });
    const form = seen[0]?.form;
    expect(form?.get("amount")).toBe("4200");
    expect(form?.get("currency")).toBe("usd");
    expect(form?.get("customer")).toBe("cus_1");
    expect(form?.get("payment_method")).toBe("pm_1");
    expect(form?.get("off_session")).toBe("true");
    expect(form?.get("confirm")).toBe("true");
    expect(form?.get("metadata[kind]")).toBe("guarantee_charge");
    expect(form?.get("metadata[purchaseId]")).toBe(charge.purchaseId);
    expect(seen[0]?.idempotencyKey).toBe(
      `guarantee-charge-${charge.purchaseId}`,
    );
  });

  it("reports a declined card with its intent, or without one", async () => {
    const decline = (payment_intent?: { id: string }) =>
      stripeAnswering({
        "/v1/payment_intents": {
          status: 402,
          body: {
            error: {
              type: "card_error",
              code: "card_declined",
              message: "declined",
              ...(payment_intent ? { payment_intent } : {}),
            },
          },
        },
      }).stripe;
    expect(await chargeSavedCard(decline({ id: "pi_x" }), charge)).toEqual({
      ok: false,
      declined: true,
      intentId: "pi_x",
    });
    expect(await chargeSavedCard(decline(), charge)).toEqual({
      ok: false,
      declined: true,
      intentId: null,
    });
  });

  it("rethrows anything else, so the next run tries again", async () => {
    const { stripe } = stripeAnswering({
      "/v1/payment_intents": {
        status: 500,
        body: { error: { type: "api_error", message: "oops" } },
      },
    });
    await expect(chargeSavedCard(stripe, charge)).rejects.toThrow("oops");
  });
});
