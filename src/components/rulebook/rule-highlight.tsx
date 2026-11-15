"use client";

import { useEffect } from "react";
import { searchTerms, stem } from "@/domain/rules/rulebook";

/** Fired by the search box after it moves the address to a result. */
export const HIGHLIGHT_EVENT = "rulebook-highlight";
const NAME = "rule-match";

/**
 * Highlights the searched words (`?h=`) in the section the address points
 * at, with the browser's CSS highlight (no markup is changed), and scrolls
 * the rule into view. Renders nothing; the static page needs no more.
 */
export function RuleHighlight() {
  useEffect(() => {
    const registry = "highlights" in CSS ? CSS.highlights : null;
    const apply = () => {
      registry?.delete(NAME);
      const found = new URLSearchParams(location.search).get("h");
      const id = decodeURIComponent(location.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!found || !target) return;
      const root = target.closest("[data-rule-section]") ?? target;
      const terms = searchTerms(found).map(
        (t) => new RegExp(`\\b${stem(t)}[a-z0-9]*`, "gi"),
      );
      if (registry && terms.length > 0) {
        const ranges: Range[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent ?? "";
          for (const re of terms)
            for (const m of text.matchAll(re)) {
              const range = new Range();
              range.setStart(n, m.index);
              range.setEnd(n, m.index + m[0].length);
              ranges.push(range);
            }
        }
        registry.set(NAME, new Highlight(...ranges));
      }
      target.scrollIntoView({ block: "center" });
    };
    apply();
    window.addEventListener(HIGHLIGHT_EVENT, apply);
    window.addEventListener("hashchange", apply);
    return () => {
      window.removeEventListener(HIGHLIGHT_EVENT, apply);
      window.removeEventListener("hashchange", apply);
      registry?.delete(NAME);
    };
  }, []);
  return null;
}
