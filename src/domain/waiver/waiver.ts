import { createHash } from "node:crypto";

/**
 * Waiver rules (product-spec.md: "A versioned waiver is shown in full;
 * signing stores the typed name, time, IP and a hash of the text").
 */

/** Line endings and trailing space do not change what a person reads. */
export function normalizeWaiverBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** SHA-256 of the normalized text, as lowercase hex. */
export function hashWaiverBody(body: string): string {
  return createHash("sha256").update(normalizeWaiverBody(body)).digest("hex");
}

const simplify = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

/**
 * Whether the typed signature is the person's full name. Case, accents,
 * punctuation and extra spaces are ignored, and a middle name may be added.
 */
export function signatureMatches(
  typed: string,
  firstName: string,
  lastName: string,
): boolean {
  const words = simplify(typed).split(" ").filter(Boolean);
  const first = simplify(firstName).split(" ").filter(Boolean);
  const last = simplify(lastName).split(" ").filter(Boolean);
  if (first.length === 0 || last.length === 0) return false;
  const starts = first.every((w, i) => words[i] === w);
  const ends = last.every(
    (w, i) => words[words.length - last.length + i] === w,
  );
  return starts && ends && words.length >= first.length + last.length;
}

export type WaiverBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/**
 * The small Markdown subset waivers use: "#" headings, "-" or "*" lists and
 * paragraphs. Rendered as plain text nodes, so no HTML in the text runs.
 */
export function waiverBlocks(body: string): WaiverBlock[] {
  const blocks: WaiverBlock[] = [];
  for (const chunk of normalizeWaiverBody(body).split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trim());
    if (lines.every((l) => /^[-*]\s+/.test(l)))
      blocks.push({
        kind: "list",
        items: lines.map((l) => l.replace(/^[-*]\s+/, "")),
      });
    else if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0] as string))
      blocks.push({
        kind: "heading",
        text: (lines[0] as string).replace(/^#{1,6}\s+/, ""),
      });
    else if (chunk.trim() !== "")
      blocks.push({ kind: "paragraph", text: lines.join(" ") });
  }
  return blocks;
}

export type WaiverDraftErrors = { title?: string; body?: string };

/** Checks a new waiver version before it is published. */
export function checkWaiverDraft(
  title: string,
  body: string,
): WaiverDraftErrors {
  const errors: WaiverDraftErrors = {};
  if (title.trim() === "" || title.trim().length > 120)
    errors.title = "Give the waiver a title of up to 120 characters.";
  const text = normalizeWaiverBody(body);
  if (text.length < 200)
    errors.body = "A waiver needs its full text (at least 200 characters).";
  else if (text.length > 50_000)
    errors.body = "Keep it under 50,000 characters.";
  return errors;
}
