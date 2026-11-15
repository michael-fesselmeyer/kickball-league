import { boroughName } from "../capacity/nearby";

/**
 * Giving back field time the league won't use (docs/permits/nyc-parks.md,
 * "Weather, closures and refunds"). Parks gives no refund, but asks to hear
 * ahead so the time can go to someone else, and a permit left unused can be
 * cut back, which costs the league its returning status. The owners call
 * the borough office or fill in Parks' online cancellation form; the app
 * only gets the answers ready.
 */

/** NYC Parks' Athletic Permit Cancellation Request form. */
export const CANCELLATION_FORM =
  "https://forms.office.com/Pages/ResponsePage.aspx?id=x2_1MoFfIk6pWxXaZlE7710LKJS3C2ZGtGmBgW1cyQFUNzJJRkoxR0pNUk02MFJUSE00STlKSFpBRi4u";

/** Where the borough offices are listed. */
export const PERMIT_OFFICES_PAGE =
  "https://www.nycgovparks.org/permits/field-and-court/contact";

/**
 * The borough sports permit offices' ballfield lines, from NYC Parks'
 * help page, read 2026-11-14. Prospect Park and the Parade Ground have
 * their own Brooklyn line.
 */
export const PERMIT_OFFICES: Readonly<Record<string, string>> = {
  B: "(718) 965-8975",
  M: "(212) 408-0234",
  Q: "(718) 393-7272",
  R: "(718) 390-8010",
  X: "(718) 430-1840",
};

const PROSPECT_PARK_LINE = "(718) 965-8974";

/** The form's borough choices. */
const FORM_BOROUGHS: Readonly<Record<string, string>> = {
  B: "BK",
  M: "MN",
  Q: "QS",
  R: "SI",
  X: "BX",
};

export function officeFor(
  borough: string | null,
  park: string | null,
): { name: string; phone: string } | null {
  if (!borough) return null;
  const phone =
    borough === "B" && park && /prospect park|parade ground/i.test(park)
      ? PROSPECT_PARK_LINE
      : PERMIT_OFFICES[borough];
  return phone
    ? { name: `${boroughName(borough)} permit office`, phone }
    : null;
}

export type UnusedReason = "rained_out" | "blackout";

const REASONS: Readonly<Record<UnusedReason, string>> = {
  rained_out: "Our games that day were rained out and moved to another date.",
  blackout: "The league isn't playing that day.",
};

export type GiveBack = {
  permitNumber: string | null;
  holder: string;
  /** YYYY-MM-DD. */
  on: string;
  borough: string | null;
  park: string;
  field: string;
  /** Local HH:MM. */
  start: string;
  end: string;
  reason: UnusedReason;
};

/** The cancellation form's questions with the league's answers, in order. */
export function formAnswers(
  g: GiveBack,
): { question: string; answer: string }[] {
  return [
    {
      question: "Permit Number",
      answer: g.permitNumber ?? "Not on file yet: copy it from the permit",
    },
    { question: "Permit Holder Name", answer: g.holder },
    { question: "Date of Requested Cancellation", answer: g.on },
    {
      question: "Borough where the permit takes place",
      answer: (g.borough && FORM_BOROUGHS[g.borough]) ?? "Pick the borough",
    },
    {
      question: "What field are you cancelling? Why?",
      answer: `${g.park}, ${g.field}, ${g.start}–${g.end}. ${REASONS[g.reason]}`,
    },
  ];
}

/** The same answers as text to paste, one per line. */
export function formText(g: GiveBack): string {
  return formAnswers(g)
    .map((a) => `${a.question}: ${a.answer}`)
    .join("\n");
}
