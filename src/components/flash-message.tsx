"use client";

import { useEffect, useRef } from "react";

/**
 * A notice or error a server action sent back through the address
 * (`?saved=` or `?error=`). A live region that is already in the page when
 * it loads is not announced by most screen readers, and on a long form the
 * message can sit below the fold. So it takes focus once when it appears:
 * the screen reader reads it, and the keyboard continues from it.
 *
 * `role="alert"` for an error, `role="status"` for a notice.
 */
export function FlashMessage({
  kind,
  children,
  className = "",
}: {
  kind: "error" | "notice";
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-lg border p-3 ${
        kind === "error" ? "border-danger" : "border-success"
      } ${className}`}
    >
      {children}
    </p>
  );
}
