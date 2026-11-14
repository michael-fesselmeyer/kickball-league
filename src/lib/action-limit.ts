import { db } from "@/db/client";
import {
  type LimitedAction,
  withinActionLimit,
} from "@/db/queries/action-limits";
import { demoStatus } from "@/lib/demo/guard";

/**
 * Whether `subject` may do `action` now, counting this request
 * (`ACTION_LIMITS`). The demo's personas are shared by every visitor and its
 * Stripe is in test mode, so there the limits would only lock visitors out
 * of trying the site; everywhere else they count.
 */
export async function allowAction(
  action: LimitedAction,
  subject: string,
): Promise<boolean> {
  if (demoStatus(process.env).on) return true;
  return withinActionLimit(db, action, subject, new Date());
}
