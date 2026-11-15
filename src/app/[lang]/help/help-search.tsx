"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { type HelpEntry, searchHelp } from "@/domain/help/search";

/**
 * Filters the how-tos as you type. Every article is also listed below it in
 * the server HTML, so the page works the same without this script.
 */
export function HelpSearch({ entries }: { entries: readonly HelpEntry[] }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const results = searching ? searchHelp(entries, query) : [];

  return (
    <div role="search" className="flex flex-col gap-3">
      <label htmlFor={id} className="font-bold">
        Search the help center
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder="Try “pay”, “rain-out” or “kicking order”"
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-11 rounded-input border border-border-strong bg-surface px-3 py-2"
      />
      <p role="status" className="text-small text-text-muted">
        {!searching
          ? ""
          : results.length === 0
            ? "Nothing matches that. Try another word, or browse the topics below."
            : `${results.length} ${results.length === 1 ? "how-to" : "how-tos"} found.`}
      </p>
      {results.length > 0 && (
        <ul aria-label="Search results" className="flex flex-col gap-2">
          {results.map((r) => (
            <li
              key={r.href}
              className="rounded-card border border-border bg-surface p-4"
            >
              <Link
                href={r.href}
                className="font-bold text-brand underline underline-offset-4"
              >
                {r.title}
              </Link>
              <span className="text-small text-text-muted"> · {r.role}</span>
              <p className="text-small">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
