import { err, ok, type Result } from "../../domain/result";
import { demoStatus } from "./guard";
import { isPersonaKey, PERSONAS } from "./personas";

/** A view-as session lasts an afternoon and ends with the browser. */
export const VIEW_AS_SESSION_SECONDS = 4 * 60 * 60;

export type ViewAsRefusal =
  /** Demo mode is off: behave as if view-as did not exist. */
  | { kind: "off"; reason: string }
  | { kind: "unknown_persona" }
  /** The demo database has not been seeded with the personas. */
  | { kind: "missing_persona" };

export type ViewAsDeps<User extends { email: string }> = {
  findUserByEmail: (email: string) => Promise<User | null>;
  startSession: (user: User) => Promise<void>;
};

/**
 * Signs the visitor in as a demo persona, with no password or email link.
 * Checks the server's own environment first, every time, so with demo mode
 * off nothing is looked up and no session is ever created.
 */
export async function viewAsPersona<User extends { email: string }>(
  env: Readonly<Record<string, string | undefined>>,
  persona: unknown,
  deps: ViewAsDeps<User>,
): Promise<Result<{ landing: string }, ViewAsRefusal>> {
  const status = demoStatus(env);
  if (!status.on) return err({ kind: "off", reason: status.reason });
  if (!isPersonaKey(persona)) return err({ kind: "unknown_persona" });

  const { email, landing } = PERSONAS[persona];
  const user = await deps.findUserByEmail(email);
  // Belt and braces: only ever an account on a persona's exact address.
  if (!user || user.email.toLowerCase() !== email)
    return err({ kind: "missing_persona" });

  await deps.startSession(user);
  return ok({ landing });
}
