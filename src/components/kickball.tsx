/** A red rubber kickball with its ridges, drawn inline so it themes with the tokens. Decorative. */
export function Kickball({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle
        cx="24"
        cy="24"
        r="21"
        className="fill-accent stroke-text"
        strokeWidth="3"
      />
      <path
        d="M7 17c11 4 23 4 34 0M4.5 25c13 4.5 26 4.5 39 0M8 33c10 3.5 22 3.5 32 0"
        fill="none"
        className="stroke-text"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
