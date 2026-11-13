import Link from "next/link";

/** The other seasons' books, as links: no script needed. */
export function SeasonPicker({
  seasons,
  current,
  path,
}: {
  seasons: readonly { slug: string; name: string }[];
  current: string;
  path: (slug: string) => string;
}) {
  const others = seasons.filter((s) => s.slug !== current);
  if (others.length === 0) return null;
  return (
    <details className="relative">
      <summary className="btn btn-secondary cursor-pointer">
        Other seasons
      </summary>
      <ul className="absolute z-10 mt-1 flex min-w-48 flex-col rounded-lg border border-border bg-surface p-1 shadow">
        {others.map((s) => (
          <li key={s.slug}>
            <Link
              href={path(s.slug)}
              className="flex min-h-11 items-center px-3 underline"
            >
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
