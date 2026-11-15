import { z } from "zod";
import { money } from "@/domain/books/ledger";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * The owners' monthly nudge (ADR 0059): expected costs waiting to be
 * confirmed and expenses still waiting on a receipt. Sent in the first
 * week of a month, only when there is something to list.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const booksNudgePayload = z.object({
  expected: z.array(
    z.object({
      label: z.string().min(1),
      dueOn: day,
      amountCents: z.number().int().positive(),
    }),
  ),
  expectedCount: z.number().int().min(0),
  receipts: z.array(
    z.object({
      spentOn: day,
      amountCents: z.number().int().positive(),
      category: z.string().min(1),
    }),
  ),
  receiptsCount: z.number().int().min(0),
});

export type BooksNudgePayload = z.infer<typeof booksNudgePayload>;

const short = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function section(
  heading: string,
  lines: readonly string[],
  total: number,
): string | null {
  if (total === 0) return null;
  const more = total - lines.length;
  return [
    heading,
    ...lines.map((l) => `• ${l}`),
    ...(more > 0 ? [`…and ${more} more`] : []),
  ].join("\n");
}

export const booksNudgeEmail = defineTemplate(booksNudgePayload, (p, ctx) => {
  const parts = [
    p.expectedCount > 0 &&
      plural(p.expectedCount, "expected cost", "expected costs"),
    p.receiptsCount > 0 &&
      plural(p.receiptsCount, "missing receipt", "missing receipts"),
  ].filter(Boolean);
  const subject = `Books: ${parts.join(" and ")}`;
  const paragraphs = [
    section(
      "To confirm (one tap each, and you can change the amount):",
      p.expected.map(
        (e) => `${e.label}, ${short(e.dueOn)}: ${money(e.amountCents)}`,
      ),
      p.expectedCount,
    ),
    section(
      "Waiting on a receipt (add a photo, or mark that there isn't one):",
      p.receipts.map(
        (r) => `${r.category}, ${short(r.spentOn)}: ${money(r.amountCents)}`,
      ),
      p.receiptsCount,
    ),
  ].filter((s): s is string => s !== null);
  return renderEmail(
    {
      subject,
      heading: "A few things to tidy in the books",
      paragraphs,
      action: { label: "Open the books", path: "/app/books" },
      reason: "you are an owner of the league",
    },
    ctx,
  );
});
