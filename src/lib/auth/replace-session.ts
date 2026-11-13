import type { GenericEndpointContext } from "better-auth";

/**
 * One browser, one session. Confirming it's you again (a new email link or
 * a passkey) is a new sign-in, which Better Auth records as a new session
 * and points the browser's cookie at. Without this, the old session would
 * stay behind and the device list would show the same phone twice. So when
 * a browser that is already signed in to an account signs in to that same
 * account again, the session it had before is ended.
 *
 * Signing in to a different account (demo view-as switching personas) keeps
 * the other account's session; it is that account's to end.
 */
export type SessionStore = {
  find(token: string): Promise<{ userId: string } | null>;
  remove(token: string): Promise<void>;
};

export async function endReplacedSession(
  created: { token: string; userId: string },
  previousToken: string | null,
  store: SessionStore,
): Promise<boolean> {
  if (!previousToken || previousToken === created.token) return false;
  const previous = await store.find(previousToken);
  if (!previous || previous.userId !== created.userId) return false;
  await store.remove(previousToken);
  return true;
}

/** Better Auth's `session.create.after` hook around `endReplacedSession`. */
export async function replacePreviousSession(
  created: { token: string; userId: string },
  ctx: GenericEndpointContext | null,
): Promise<void> {
  if (!ctx) return; // created outside a request, so there is no browser
  const previousToken = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  );
  const adapter = ctx.context.internalAdapter;
  await endReplacedSession(created, previousToken || null, {
    find: async (token) => {
      const found = await adapter.findSession(token);
      return found ? { userId: found.session.userId } : null;
    },
    remove: (token) => adapter.deleteSession(token),
  });
}
