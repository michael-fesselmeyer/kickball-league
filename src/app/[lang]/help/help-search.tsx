"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { type HelpEntry, searchHelp } from "@/domain/help/search";
import { fill } from "@/i18n/catalog";
import type { Messages } from "@/i18n/messages";

/**
 * Filters the how-tos as you type. Every article is also listed below it in
 * the server HTML, so the page works the same without this script.
 */
export function HelpSearch({
  entries,
  words,
}: {
  entries: readonly HelpEntry[];
  /** The page's words, in its language (ADR 0065). */
  words: Messages["help"]["search"];
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const results = searching ? searchHelp(entries, query) : [];

  return (
    <div role="search" className="flex flex-col gap-3">
      <label htmlFor={id} className="font-bold">
        {words.label}
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder={words.placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-11 rounded-input border border-border-strong bg-surface px-3 py-2"
      />
      <p role="status" className="text-small text-text-muted">
        {!searching
          ? ""
          : results.length === 0
            ? words.none
            : fill(results.length === 1 ? words.found : words.foundMany, {
                n: results.length,
              })}
      </p>
      {results.length > 0 && (
        <ul aria-label={words.results} className="flex flex-col gap-2">
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
