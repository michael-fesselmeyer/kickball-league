import Link from "next/link";

export type Action = {
  href: string;
  label: string;
  /** A file download or other non-page address: a plain link, never prefetched. */
  file?: boolean;
};

/**
 * A screen's actions in one row: the main one as a button, the rest folded
 * under "More". A phone sees the screen's content first instead of a stack of
 * buttons. A native <details>, so it needs no script; the list opens over
 * the content just below the row, as wide as the row on a phone.
 */
export function MoreActions({
  label,
  primary,
  more,
}: {
  /** Names the group for screen readers ("Game day actions"). */
  label: string;
  primary?: Action;
  more: Action[];
}) {
  return (
    <nav aria-label={label} className="relative">
      <div className="flex flex-wrap items-start gap-2">
        {primary && (
          <Link href={primary.href} className="btn btn-primary">
            {primary.label}
          </Link>
        )}
        {more.length > 0 && (
          <details className="group">
            <summary className="btn cursor-pointer list-none btn-secondary [&::-webkit-details-marker]:hidden">
              More
              <span
                aria-hidden="true"
                className="text-text-muted transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <ul className="absolute inset-x-0 top-full z-20 mt-2 flex flex-col rounded-card border-2 border-text bg-surface px-4 py-1 shadow-sticker sm:right-auto sm:min-w-72">
              {more.map((a) => (
                <li
                  key={a.href}
                  className="border-b border-border last:border-b-0"
                >
                  {a.file ? (
                    <a
                      href={a.href}
                      className="flex min-h-11 items-center hover:underline"
                    >
                      {a.label}
                    </a>
                  ) : (
                    <Link
                      href={a.href}
                      prefetch={false}
                      className="flex min-h-11 items-center hover:underline"
                    >
                      {a.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </nav>
  );
}
