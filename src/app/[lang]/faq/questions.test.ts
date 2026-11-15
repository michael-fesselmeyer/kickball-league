import { describe, expect, it } from "vitest";
import { faqFor } from "./questions";

describe("the FAQ", () => {
  it("asks the same questions in each language, with the same links", () => {
    const en = faqFor("en");
    const es = faqFor("es");
    expect(es.map((g) => g.id)).toEqual(en.map((g) => g.id));
    expect(es.map((g) => g.questions.length)).toEqual(
      en.map((g) => g.questions.length),
    );
    expect(es.flatMap((g) => g.questions.map((q) => q.more?.href))).toEqual(
      en.flatMap((g) => g.questions.map((q) => q.more?.href)),
    );
    expect(es[0]?.questions[0]?.question).toBe(
      "¿Necesito un equipo para unirme?",
    );
  });
});
