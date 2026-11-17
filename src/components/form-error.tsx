"use client";

import { useEffect, useRef } from "react";

/**
 * A form's error summary after a server-side check fails. The form is
 * submitted with the button at the bottom, so on its own the alert would sit
 * off screen with focus on <body>. When a new error arrives this moves focus
 * to the summary and scrolls it into view, so a keyboard or screen-reader
 * user lands on it and a phone user sees it.
 *
 * `attempt` is anything that changes on every submission (the action's state
 * object), so the same message twice in a row still moves focus.
 */
export function FormError({
  message,
  attempt,
  className = "",
}: {
  message: string | null | undefined;
  attempt?: unknown;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  }, [message, attempt]);

  if (!message) return null;
  return (
    <p
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={`rounded-lg border border-danger p-3 ${className}`}
    >
      {message}
    </p>
  );
}
