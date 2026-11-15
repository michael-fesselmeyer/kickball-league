"use client";

/** Opens the browser's print dialog: the pack's only client code. */
export function PrintButton() {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => window.print()}
    >
      Print
    </button>
  );
}
