import { z } from "zod";
import { HALVES, MAX_INNINGS } from "./live";
import { MAX_RUNS, OUTCOMES } from "./scores";

/**
 * The shape of a score entry saved on a phone with no signal, as the
 * server receives it (rules in ./offline.ts; ADR 0025).
 */

export const OFFLINE_KINDS = ["score", "half", "end"] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = z.string().regex(UUID);
const runs = z.number().int().min(0).max(MAX_RUNS);

const common = {
  key: id,
  gameId: id,
  /** Who was signed in when it was saved. */
  userId: id,
  /** When it was saved, by the phone's clock. */
  enteredAt: z.iso.datetime(),
};

const entrySchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("score"),
    /** The score's version when the form was shown (`scoreVersion`). */
    version: z.string().max(80),
    score: z.object({
      outcome: z.enum(OUTCOMES),
      scoreA: runs,
      scoreB: runs,
      inningsPlayed: z.number().int().min(1).max(MAX_INNINGS).nullable(),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal("half"),
    inning: z.number().int().min(1).max(MAX_INNINGS),
    half: z.enum(HALVES),
    runs,
    /** The runs this half had on the phone; null for a new half. */
    was: runs.nullable(),
  }),
  z.object({
    ...common,
    kind: z.literal("end"),
    version: z.string().max(80),
    ending: z.enum(["normal", "called"]),
  }),
]);

export type OfflineEntry = z.infer<typeof entrySchema>;
export type OfflineScore = Extract<OfflineEntry, { kind: "score" }>;
export type OfflineHalf = Extract<OfflineEntry, { kind: "half" }>;
export type OfflineEnd = Extract<OfflineEntry, { kind: "end" }>;

/** An entry as the phone sent it, or null when it is not one. */
export function parseOfflineEntry(value: unknown): OfflineEntry | null {
  const parsed = entrySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
