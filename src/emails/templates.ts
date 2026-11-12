import type { z } from "zod";
import type { Rendered, Renderer } from "@/db/queries/outbox";
import { err, ok } from "@/domain/result";
import type { RenderContext } from "./layout";

/**
 * Every email the outbox can send, by the template name stored on the
 * message row. A message stores its template's payload, not the finished
 * email; the payload is checked against the template's schema again when
 * it is sent, so a malformed row fails instead of sending something broken.
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

/** Template name to renderer. Each kind of league message adds one. */
const TEMPLATES: Readonly<Record<string, Template>> = {};

/** The outbox's renderer for this site. */
export function rendererFor(context: RenderContext): Renderer {
  return (name, payload) => {
    const template = TEMPLATES[name];
    return template
      ? template(payload, context)
      : err(`No email template named ${name}`);
  };
}
