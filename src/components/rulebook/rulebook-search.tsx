"use client";

import { useEffect, useId, useState } from "react";
import { searchTerms } from "@/domain/rules/rulebook";
import { HIGHLIGHT_EVENT } from "./rule-highlight";

type Result = {
  slug: string;
  title: string;
  hits: { anchor: string | null; number: string | null; snippet: string }[];
};

/**
 * Search box for the rulebook (ADR 0065): asks the server's full-text search
 * as the person types, lists the sections and the rules that matched, and a
 * tap moves to the rule and highlights the words, without reloading the page.
 */
export function RulebookSearch({
  searchUrl,
  pagePath,
}: {
  /** The league's search address. */
  searchUrl: string;
  /** The page the results link to, without a query or hash. */
  pagePath: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{
    key: string;
    results: Result[] | null;
  } | null>(null);
  const terms = searchTerms(query);
  const key = terms.join(" ");
  const searching = key.length >= 2;
  const state: {
    status: "idle" | "loading" | "failed" | "done";
    results: Result[];
  } = !searching
    ? { status: "idle", results: [] }
    : answer?.key !== key
      ? { status: "loading", results: [] }
      : answer.results === null
        ? { status: "failed", results: [] }
        : { status: "done", results: answer.results };

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${searchUrl}?q=${encodeURIComponent(key)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: Result[] };
        setAnswer({ key, results: body.results });
      } catch {
        if (!controller.signal.aborted) setAnswer({ key, results: null });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, searching, searchUrl]);

  const hrefFor = (target: string) =>
    `${pagePath}?h=${encodeURIComponent(key)}#${target}`;
  const go = (event: React.MouseEvent, target: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
      return;
    event.preventDefault();
    history.pushState(null, "", hrefFor(target));
    window.dispatchEvent(new Event(HIGHLIGHT_EVENT));
  };

  return (
    <div role="search" className="flex flex-col gap-2">
      <label htmlFor={id} className="text-h3">
        Search the rules
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Try “bunting” or “foul”"
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body"
      />
      <div role="status" aria-live="polite" className="text-small">
        {state.status === "loading" && (
          <span className="text-text-muted">Searching…</span>
        )}
        {state.status === "failed" && (
          <span>
            Search isn&apos;t working right now. Try again in a moment.
          </span>
        )}
        {state.status === "done" && state.results.length === 0 && (
          <span className="text-text-muted">
            No rule has all of those words. Try fewer words.
          </span>
        )}
        {state.status === "done" && state.results.length > 0 && (
          <span className="text-text-muted">
            {state.results.length}{" "}
            {state.results.length === 1 ? "section matches" : "sections match"}
          </span>
        )}
      </div>
      {state.status === "done" && state.results.length > 0 && (
        <ul className="flex flex-col">
          {state.results.map((r) => (
            <li
              key={r.slug}
              className="flex flex-col border-t border-border py-2"
            >
              <a
                href={hrefFor(r.slug)}
                onClick={(e) => go(e, r.slug)}
                className="flex min-h-11 items-center font-bold underline"
              >
                {r.title}
              </a>
              <ul className="flex flex-col">
                {r.hits.map((h, i) => (
                  <li key={h.anchor ?? i}>
                    <a
                      href={hrefFor(h.anchor ?? r.slug)}
                      onClick={(e) => go(e, h.anchor ?? r.slug)}
                      className="flex min-h-11 items-center gap-3"
                    >
                      {h.number && (
                        <span className="min-w-10 font-bold text-brand">
                          {h.number}
                        </span>
                      )}
                      <span className="text-small">{h.snippet}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
