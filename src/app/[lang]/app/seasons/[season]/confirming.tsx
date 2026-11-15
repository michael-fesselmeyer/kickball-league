"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Back from Checkout, the webhook may not have arrived yet. Refresh the page
 * a few times while it does, then say so plainly.
 */
export function ConfirmingPayment() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 8) return;
    const timer = setTimeout(() => {
      router.refresh();
      setTries((t) => t + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [tries, router]);
  return (
    <p role="status" className="rounded-lg border border-border p-3">
      {tries < 8
        ? "Confirming your payment with Stripe…"
        : "Stripe has not confirmed the payment yet. It usually takes a minute; check back shortly."}
    </p>
  );
}
