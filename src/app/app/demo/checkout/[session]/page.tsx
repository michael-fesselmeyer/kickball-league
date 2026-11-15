import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { openDemoCheckout } from "@/db/queries/demo";
import { formatCents } from "@/domain/registration/pricing";
import { requireSelf } from "@/lib/auth/permission";
import { demoCheckoutOn, returnPath } from "@/lib/demo/checkout";
import { SubmitButton } from "@/components/submit-button";
import { payDemoCheckout } from "../actions";

export const metadata: Metadata = { title: "Demo checkout" };

/**
 * The local demo's stand-in for Stripe's Checkout page
 * (docs/adr/0052-local-demo-runs-offline.md): it shows what is being paid
 * for and "pays" with a signed test webhook, so registration and checkout
 * complete without a network or a card. A 404 everywhere else.
 */
export default function DemoCheckoutPage(
  props: PageProps<"/app/demo/checkout/[session]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <h1 className="text-h1">Demo checkout</h1>
      <Suspense fallback={<p className="min-h-48">Loading checkout…</p>}>
        <Checkout {...props} />
      </Suspense>
    </main>
  );
}

async function Checkout({
  params,
  searchParams,
}: PageProps<"/app/demo/checkout/[session]">) {
  if (!demoCheckoutOn(process.env)) notFound();
  const { session } = await params;
  const query = await searchParams;
  const back = returnPath(query.back);
  const subject = await requireSelf(
    "payment.pay_own",
    `/app/demo/checkout/${encodeURIComponent(session)}`,
  );

  if (query.mode === "setup")
    return (
      <section className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-4">
        <p>
          On the league&apos;s site, this is where a captain saves a card to
          guarantee the team&apos;s balance. Stripe keeps the card; the league
          never sees it. Saving a card is skipped in this demo.
        </p>
        <Link href={back} className="btn self-start btn-primary">
          Back to the team
        </Link>
      </section>
    );

  const found = await openDemoCheckout(db, subject.userId, session);
  if (!found)
    return (
      <section className="flex flex-col gap-4">
        <p>This checkout is already paid or has closed.</p>
        <Link href={back} className="btn self-start btn-secondary">
          Go back
        </Link>
      </section>
    );

  const pay = payDemoCheckout.bind(null, session, back);
  return (
    <section
      aria-labelledby="paying-for"
      className="flex flex-col gap-4 rounded-card border-2 border-text bg-surface p-4"
    >
      <h2 id="paying-for" className="text-h3">
        Paying for
      </h2>
      <ul className="flex flex-col gap-1">
        {found.items.map((item) => (
          <li key={item.description} className="flex justify-between gap-4">
            <span>{item.description}</span>
            <span className="tabular-nums">
              {formatCents(item.amountCents)}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between gap-4 border-t-2 border-text pt-2 font-bold">
        <span>Total</span>
        <span className="tabular-nums">{formatCents(found.totalCents)}</span>
      </p>
      {query.error && (
        <p role="alert" className="text-danger">
          The demo payment didn&apos;t go through. Try again.
        </p>
      )}
      <p className="text-small text-text-muted">
        Demo payment: no card is charged. On the league&apos;s site this page is
        Stripe&apos;s, and the payment is confirmed the same way, by a signed
        message from Stripe.
      </p>
      <div className="flex flex-wrap gap-3">
        <form action={pay}>
          <SubmitButton className="btn btn-primary">
            Pay {formatCents(found.totalCents)} (demo)
          </SubmitButton>
        </form>
        <Link href={back} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </section>
  );
}
