import type { z } from "zod";
import type { Rendered, Renderer } from "@/db/queries/outbox";
import { err, ok } from "@/domain/result";
import type { RenderContext } from "./layout";

/**
 * One kind of outbox email. A message stores its template's payload, not the
 * finished email; the payload is checked against the template's schema again
 * when it is sent, so a malformed row fails instead of sending something
 * broken.
 */
export type Template = (
  payload: unknown,
  context: RenderContext,
) => ReturnType<Renderer>;

export function defineTemplate<Payload>(
  schema: z.ZodType<Payload>,
  render: (payload: Payload, context: RenderContext) => Rendered,
): Template {
  return (payload, context) => {
    const parsed = schema.safeParse(payload);
    return parsed.success
      ? ok(render(parsed.data, context))
      : err("The message payload does not match its template");
  };
}
