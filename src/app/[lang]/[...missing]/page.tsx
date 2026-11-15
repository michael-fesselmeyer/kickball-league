import { notFound } from "next/navigation";

/**
 * Any address no page matches. Every page lives under `[lang]` (ADR 0065),
 * so the not-found page needs this to render inside the language's layout.
 */
export default function Missing(): never {
  notFound();
}
