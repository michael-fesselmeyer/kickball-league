import { z } from "zod";
import { defineTemplate } from "./define";
import { renderEmail } from "./layout";

/**
 * Tells the owners about a season's NYC Parks permits (ADR 0055): the
 * season's permitted hours nearing or passing the 50-hour insurance line,
 * or field time coming up that the league won't use and should give back.
 * Nothing is sent to NYC Parks; the email says who to call and links to
 * the permits screen, where the cancellation form's answers are ready.
 * Also: games or events at a park that a permit no longer covers, after a
 * permit was marked lost or a window removed (issue #407).
 */
const office = z.object({ name: z.string(), phone: z.string() }).nullable();

export const permitAlertPayload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["hours_near", "hours_over"]),
    season: z.string().min(1),
    seasonSlug: z.string().min(1),
    hours: z.number().min(0),
    /** The line the alert is about: 40 when close, 50 when over. */
    line: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("give_back"),
    season: z.string().min(1),
    seasonSlug: z.string().min(1),
    /** YYYY-MM-DD. */
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Such as "McCarren Park, Baseball 2". */
    place: z.string().min(1),
    /** Such as "12:00–18:00". */
    hours: z.string().min(1),
    permitNumber: z.string().nullable(),
    office,
  }),
  z.object({
    kind: z.literal("uncovered"),
    /** All the items that lost their cover; `items` lists the first few. */
    count: z.number().int().positive(),
    items: z
      .array(
        z.object({
          what: z.string().min(1),
          when: z.string().min(1),
          place: z.string().min(1),
          why: z.string().min(1),
        }),
      )
      .min(1)
      .max(10),
  }),
]);

export type PermitAlertPayload = z.infer<typeof permitAlertPayload>;

const longDate = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

export const permitAlertEmail = defineTemplate(permitAlertPayload, (p, ctx) => {
  if (p.kind === "uncovered") {
    const subject =
      p.count === 1
        ? "A game or event is no longer covered by a permit"
        : `${p.count} games or events are no longer covered by a permit`;
    const more = p.count - p.items.length;
    return renderEmail(
      {
        subject,
        heading: subject,
        paragraphs: [
          "A permit was marked lost or a permit window was removed, so the league no longer holds the field for:",
          ...p.items.map((i) => `${i.what}, ${i.when}, ${i.place}. ${i.why}`),
          ...(more > 0 ? [`And ${more} more on the permits screen.`] : []),
          "Move them, get the permit back, or call them off before anyone turns up.",
        ],
        action: { label: "Open permits", path: "/app/books/permits" },
        reason: "you are an owner of the league",
      },
      ctx,
    );
  }
  const path = `/app/books/${p.seasonSlug}/permits`;
  if (p.kind === "give_back") {
    const subject = `Give back ${p.place} on ${longDate(p.on)}`;
    return renderEmail(
      {
        subject,
        heading: subject,
        paragraphs: [
          `${p.season} won't use its permitted time at ${p.place}, ${p.hours}${p.permitNumber ? ` (permit ${p.permitNumber})` : ""}.`,
          p.office
            ? `Call the ${p.office.name} at ${p.office.phone}, or use NYC Parks' online cancellation form, so the time can go to someone else. Giving it back keeps the league in good standing for its renewal.`
            : "Call the borough permit office, or use NYC Parks' online cancellation form, so the time can go to someone else. Giving it back keeps the league in good standing for its renewal.",
          "The permits screen has the form's answers ready to copy.",
        ],
        action: { label: "Open permits", path },
        reason: "you are an owner of the league",
      },
      ctx,
    );
  }
  const over = p.kind === "hours_over";
  const subject = over
    ? `${p.season} is over NYC Parks' 50-hour insurance line`
    : `${p.season} is close to NYC Parks' 50-hour insurance line`;
  return renderEmail(
    {
      subject,
      heading: subject,
      paragraphs: [
        `The season's permits add up to ${p.hours.toLocaleString("en-US")} hours.`,
        over
          ? "With more than 50 permitted hours, NYC Parks asks for liability insurance naming the City and a notarized broker's certification form, and takes no more applications until both are approved."
          : "Past 50 permitted hours, NYC Parks asks for liability insurance naming the City and a notarized broker's certification form. Start on them now if the league will ask for more time.",
      ],
      action: { label: "Open permits", path },
      reason: "you are an owner of the league",
    },
    ctx,
  );
});
