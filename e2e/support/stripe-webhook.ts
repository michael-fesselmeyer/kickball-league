import type { APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import Stripe from "stripe";

/**
 * Stripe's side of a payment, for the end-to-end flows. stripe-mock answers
 * the API but never calls the app back, so these build the webhook event
 * Stripe would send and sign it with the flows server's test secret
 * (playwright.config.ts). The app checks the signature exactly as it does
 * for Stripe.
 */
const WEBHOOK_SECRET = "whsec_e2e";
const stripe = new Stripe("sk_test_e2e");

/**
 * The Checkout session of a person's newest open purchase, in one season
 * when given: flows running side by side may each have the same persona
 * paying in a different season.
 */
export async function openCheckoutSession(
  email: string,
  seasonSlug?: string,
): Promise<{
  sessionId: string;
  totalCents: number;
}> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      session: string | null;
      total: number;
    }>(
      `select p.stripe_checkout_session_id as session, p.total_cents as total
         from purchase p join "user" u on u.id = p.user_id
         left join season s on s.id = p.season_id
        where u.email = $1 and p.status = 'open'
          and ($2::text is null or s.slug = $2)
        order by p.created_at desc limit 1`,
      [email, seasonSlug ?? null],
    );
    const row = rows[0];
    if (!row?.session) throw new Error(`No open checkout for ${email}`);
    return { sessionId: row.session, totalCents: row.total };
  } finally {
    await client.end();
  }
}

let sequence = 0;

type Delivery = { status: number; outcome: string | undefined };

/** Signs an event with the flows server's test secret and posts it. */
async function deliver(
  request: APIRequestContext,
  event: { id: string; type: string; object: Record<string, unknown> },
): Promise<Delivery> {
  const payload = JSON.stringify({
    id: event.id,
    object: "event",
    type: event.type,
    data: { object: event.object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  const response = await request.post("/api/stripe/webhook", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  const outcome =
    body && typeof body === "object" && "outcome" in body
      ? String(body.outcome)
      : undefined;
  return { status: response.status(), outcome };
}

const nextEventId = () => `evt_e2e_${Date.now()}_${++sequence}`;

/**
 * Posts a signed `checkout.session.completed` event, as Stripe does once
 * the card is charged. Sending the same `eventId` again is a replay.
 */
export async function sendCheckoutCompleted(
  request: APIRequestContext,
  session: { sessionId: string; totalCents: number },
  eventId = nextEventId(),
): Promise<Delivery> {
  return deliver(request, {
    id: eventId,
    type: "checkout.session.completed",
    object: {
      id: session.sessionId,
      object: "checkout.session",
      payment_status: "paid",
      payment_intent: `pi_e2e_${session.sessionId}`,
      amount_total: session.totalCents,
      created: Math.floor(Date.now() / 1000),
    },
  });
}

/**
 * Posts a signed `charge.refunded` event for a person's newest Stripe
 * payment (in one season when given), carrying every refund an admin has sent so far, as Stripe does
 * once it has returned the money. stripe-mock accepts the refund but does not
 * remember it, so the total comes from the app's own refund rows.
 */
export async function sendChargeRefunded(
  request: APIRequestContext,
  email: string,
  seasonSlug?: string,
  eventId = nextEventId(),
): Promise<Delivery & { refundedCents: number }> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let row: { intent: string; refunded: number } | undefined;
  try {
    const { rows } = await client.query<{ intent: string; refunded: number }>(
      `select pm.stripe_payment_intent_id as intent,
              (select coalesce(sum(r.amount_cents), 0)::int
                 from refund r where r.payment_id = pm.id) as refunded
         from payment pm
         join purchase p on p.id = pm.purchase_id
         join "user" u on u.id = p.user_id
         left join season s on s.id = p.season_id
        where u.email = $1 and pm.method = 'stripe'
          and ($2::text is null or s.slug = $2)
        order by pm.created_at desc limit 1`,
      [email, seasonSlug ?? null],
    );
    row = rows[0];
  } finally {
    await client.end();
  }
  if (!row) throw new Error(`No Stripe payment for ${email}`);
  const delivered = await deliver(request, {
    id: eventId,
    type: "charge.refunded",
    object: {
      id: `ch_e2e_${row.intent}`,
      object: "charge",
      payment_intent: row.intent,
      amount_refunded: row.refunded,
    },
  });
  return { ...delivered, refundedCents: row.refunded };
}

/** Runs a query against the flows database. */
async function sql<Row extends Record<string, unknown>>(
  text: string,
  values: unknown[],
): Promise<Row[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<Row>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Posts a signed `checkout.session.completed` for a Checkout session in
 * setup mode, as Stripe does when a captain saves a guarantee card. The
 * SetupIntent comes expanded with a test card, because stripe-mock's own
 * SetupIntent has none; stripe-mock then describes the card.
 */
export async function sendCardSaved(
  request: APIRequestContext,
  email: string,
  eventId = nextEventId(),
): Promise<Delivery> {
  const [row] = await sql<{ user_id: string; team_season_id: string }>(
    `select u.id as user_id, rm.team_season_id
       from "user" u
       join registration r on r.user_id = u.id
       join roster_membership rm on rm.registration_id = r.id
      where u.email = $1 and rm.role = 'captain' and rm.status = 'active'
      order by r.created_at desc limit 1`,
    [email],
  );
  if (!row) throw new Error(`No team captained by ${email}`);
  const session = `cs_e2e_setup_${Date.now()}`;
  return deliver(request, {
    id: eventId,
    type: "checkout.session.completed",
    object: {
      id: session,
      object: "checkout.session",
      mode: "setup",
      customer: "cus_e2e",
      metadata: {
        kind: "guarantee",
        userId: row.user_id,
        teamSeasonId: row.team_season_id,
      },
      setup_intent: {
        id: `seti_${session}`,
        object: "setup_intent",
        customer: "cus_e2e",
        payment_method: "pm_e2e_card",
      },
    },
  });
}

/**
 * Moves a season's payment deadline, and the guarantee warnings sent for
 * it, as if time had passed: the flows cannot wait three days.
 */
export async function moveDeadline(
  seasonSlug: string,
  deadline: Date,
  warnedAt?: Date,
): Promise<void> {
  await sql(`update season set payment_deadline_at = $2 where slug = $1`, [
    seasonSlug,
    deadline,
  ]);
  if (warnedAt)
    await sql(
      `update saved_payment_method spm
          set warned_at = $2, warned_for_deadline = $3
         from team_season ts join season s on s.id = ts.season_id
        where spm.team_season_id = ts.id and s.slug = $1
          and spm.removed_at is null and spm.warned_at is not null`,
      [seasonSlug, warnedAt, deadline],
    );
}

/**
 * Posts a signed `payment_intent.succeeded` for the newest deadline charge
 * of a captain's guarantee, as Stripe does once the saved card is charged.
 */
export async function sendGuaranteeCharged(
  request: APIRequestContext,
  email: string,
  eventId = nextEventId(),
): Promise<Delivery & { cents: number }> {
  const [row] = await sql<{ intent: string | null; id: string; cents: number }>(
    `select p.stripe_payment_intent_id as intent, p.id, p.total_cents as cents
       from saved_payment_method spm
       join purchase p on p.id = spm.charge_purchase_id
       join "user" u on u.id = spm.user_id
      where u.email = $1
      order by p.created_at desc limit 1`,
    [email],
  );
  if (!row?.intent) throw new Error(`No deadline charge for ${email}`);
  const delivered = await deliver(request, {
    id: eventId,
    type: "payment_intent.succeeded",
    object: {
      id: row.intent,
      object: "payment_intent",
      amount: row.cents,
      amount_received: row.cents,
      metadata: { purchaseId: row.id },
    },
  });
  return { ...delivered, cents: row.cents };
}

/** The Checkout session of a person's open ticket checkout for an event. */
export async function openTicketCheckout(
  email: string,
  eventSlug: string,
): Promise<{ sessionId: string; totalCents: number }> {
  const [row] = await sql<{ session: string | null; total: number }>(
    `select p.stripe_checkout_session_id as session, p.total_cents as total
       from event_ticket t
       join event e on e.id = t.event_id
       join purchase p on p.id = t.purchase_id
       join "user" u on u.id = t.user_id
      where u.email = $1 and e.slug = $2 and t.status = 'held'
        and p.status = 'open'
      order by p.created_at desc limit 1`,
    [email, eventSlug],
  );
  if (!row?.session)
    throw new Error(`No open ticket checkout for ${email} at ${eventSlug}`);
  return { sessionId: row.session, totalCents: row.total };
}

/** The Checkout session of a person's open merch checkout for an item. */
export async function openMerchCheckout(
  email: string,
  itemName: string,
): Promise<{ sessionId: string; totalCents: number; creditCents: number }> {
  const [row] = await sql<{
    session: string | null;
    total: number;
    credit: number;
  }>(
    `select p.stripe_checkout_session_id as session, p.total_cents as total,
            p.credit_applied_cents as credit
       from merch_order o
       join merch_item i on i.id = o.item_id
       join purchase p on p.id = o.purchase_id
       join "user" u on u.id = o.user_id
      where u.email = $1 and i.name = $2 and o.status = 'held'
        and p.status = 'open'
      order by p.created_at desc limit 1`,
    [email, itemName],
  );
  if (!row?.session)
    throw new Error(`No open merch checkout for ${email}: ${itemName}`);
  return {
    sessionId: row.session,
    totalCents: row.total,
    creditCents: row.credit,
  };
}
