import type { Locale } from "@/i18n/locales";
import { type Messages, messagesFor } from "@/i18n/messages";
import type { Question } from "@/lib/seo/structured-data";

export type Faq = Question & {
  /** Where to read more, shown under the answer. */
  more?: { href: string; label: string };
};

export type FaqGroup = { id: string; title: string; questions: Faq[] };

type Words = Messages["faq"];

/**
 * The FAQ's sections and questions, in order. The words live in the
 * message catalogs (ADR 0094); this is only their shape and links.
 */
const LAYOUT = [
  {
    id: "joining",
    key: "joining",
    questions: ["team", "friend", "age", "skill"],
  },
  {
    id: "season",
    key: "season",
    questions: ["when", "where", "cost", "length", "coed", "rain"],
  },
  { id: "game-day", key: "gameDay", questions: ["wear", "drink", "watch"] },
] as const;

/** Where a question's "read more" link goes. */
const MORE: Partial<Record<string, string>> = {
  "season.where": "/parks/mccarren-park",
};

/**
 * The FAQ in a language. The page and its structured data both read this,
 * so what search engines see is exactly what visitors read. Answers are
 * plain text and lead with the answer (docs/seo-plan.md, section 4).
 */
export function faqFor(locale: Locale): FaqGroup[] {
  const words: Words = messagesFor(locale).faq;
  return LAYOUT.map((group) => {
    const section = words[group.key];
    return {
      id: group.id,
      title: section.title,
      questions: group.questions.map((q) => {
        const entry = (section as Record<string, unknown>)[q] as {
          question: string;
          answer: string;
          more?: string;
        };
        const href = MORE[`${group.key}.${q}`];
        return {
          question: entry.question,
          answer: entry.answer,
          ...(href && entry.more ? { more: { href, label: entry.more } } : {}),
        };
      }),
    };
  });
}
