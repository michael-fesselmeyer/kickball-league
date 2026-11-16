import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * The not-found page's title. Its metadata is read from the page the
 * address matched, this one, not from `[lang]/not-found.tsx`, which only a
 * root not-found page could set.
 */
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

/**
 * Any address no page matches. Every page lives under `[lang]` (ADR 0094),
 * so the not-found page needs this to render inside the language's layout.
 */
export default function Missing(): never {
  notFound();
}
