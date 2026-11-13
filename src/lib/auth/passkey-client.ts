import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

/**
 * The browser half of Better Auth's passkey plugin. Pages never import this
 * directly: they load it with `import()` when it is needed, so the WebAuthn
 * code stays out of every page's first load (docs/design-system.md,
 * Performance budgets).
 */
const client = createAuthClient({ plugins: [passkeyClient()] });

export type PasskeyResult = { ok: true } | { ok: false; message: string };

/** The browser's own cancel, which isn't an error to show. */
const CANCELLED = new Set([
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

function result(
  error: { code?: string | undefined; message?: string | undefined } | null,
  fallback: string,
): PasskeyResult {
  if (!error) return { ok: true };
  if (error.code && CANCELLED.has(error.code))
    return { ok: false, message: "" };
  return { ok: false, message: error.message || fallback };
}

/** Signs in (or confirms it's you) with a passkey saved on this device. */
export async function signInWithPasskey(): Promise<PasskeyResult> {
  const { error } = await client.signIn.passkey();
  return result(error, "That passkey didn't work. Try again or use email.");
}

/**
 * Offers saved passkeys in the email field's autofill (WebAuthn conditional
 * mediation). Resolves when one is picked and signed in; never rejects.
 */
export async function passkeyAutofill(): Promise<boolean> {
  try {
    const { error } = await client.signIn.passkey({ autoFill: true });
    return !error;
  } catch {
    return false;
  }
}

/** Saves a new passkey for the signed-in account on this device. */
export async function addPasskey(name: string): Promise<PasskeyResult> {
  const response = await client.passkey.addPasskey({ name });
  return result(
    response?.error ?? null,
    "We couldn't save the passkey. Try again.",
  );
}
