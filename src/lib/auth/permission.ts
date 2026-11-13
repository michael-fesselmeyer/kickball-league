import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { loadSubject } from "@/db/queries/subject";
import {
  type Action,
  type Context,
  can,
  type Subject,
} from "@/domain/authz/permissions";
import { parseId, type UserId } from "@/domain/ids";
import { canWrite } from "@/domain/platform/operator";
import { err, ok, type Result } from "@/domain/result";
import { currentSite, isCurrentOperator } from "@/lib/platform/site";
import { isFreshSession } from "./config";
import { auth } from "./index";

/** The signed-in person as a permissions subject; a visitor when signed out. */
export async function currentSubject(): Promise<Subject> {
  const session = await auth.api.getSession({ headers: await headers() });
  // Account ids are UUIDs; anything else is treated as signed out.
  return loadSubject(db, parseId<UserId>(session?.user.id));
}

export type SignedInSubject = Subject & { userId: UserId };

const isSignedIn = (subject: Subject): subject is SignedInSubject =>
  subject.userId !== null;

/**
 * While the operator has the site read-only or paused, a change stops here
 * for everyone but the operator, before anything is written.
 */
async function refuseWritesWhileFrozen(subject: SignedInSubject) {
  if (await writesFrozen(subject)) redirect("/paused");
}

async function writesFrozen(subject: SignedInSubject): Promise<boolean> {
  const site = await currentSite();
  return !!site && !canWrite(site.status, isCurrentOperator(subject.userId));
}

/**
 * Stops unless the signed-in person may do `action`. Signed-out visitors go
 * to sign-in; anyone else without the right gets a 404, so admin pages do
 * not reveal that they exist.
 */
export async function requirePermission(
  action: Action,
  { next, ...context }: Context & { next: string },
): Promise<SignedInSubject> {
  const subject = await currentSubject();
  if (!isSignedIn(subject))
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!can(subject, action, context)) notFound();
  return subject;
}

/**
 * For Server Actions: `requirePermission`, and also stops while the site is
 * read-only or paused (ADR 0009). Every Server Action uses this or
 * `requireSelfToChange`; a test checks it.
 */
export async function requirePermissionToChange(
  action: Action,
  options: Context & { next: string },
): Promise<SignedInSubject> {
  const subject = await requirePermission(action, options);
  await refuseWritesWhileFrozen(subject);
  return subject;
}

export type ChangeRefusal = "signed_out" | "forbidden" | "frozen";

/**
 * For Route Handlers that change data, which answer instead of redirecting:
 * the same checks as `requirePermissionToChange`, as a result.
 */
export async function permissionToChange(
  action: Action,
  context: Context = {},
): Promise<Result<SignedInSubject, ChangeRefusal>> {
  const subject = await currentSubject();
  if (!isSignedIn(subject)) return err("signed_out");
  if (!can(subject, action, context)) return err("forbidden");
  if (await writesFrozen(subject)) return err("frozen");
  return ok(subject);
}

/**
 * The signed-in person, if they may act on their own record (profile edits,
 * waivers, their own payments). Signed-out visitors go to sign-in.
 */
export async function requireSelf(
  action: Action,
  next: string,
): Promise<SignedInSubject> {
  const subject = await currentSubject();
  if (!isSignedIn(subject))
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!can(subject, action, { targetUserId: subject.userId })) notFound();
  return subject;
}

/** For Server Actions: `requireSelf`, and also stops while the site is frozen. */
export async function requireSelfToChange(
  action: Action,
  next: string,
): Promise<SignedInSubject> {
  const subject = await requireSelf(action, next);
  await refuseWritesWhileFrozen(subject);
  return subject;
}

/** The current session's id and when it was signed in; null when signed out. */
export async function currentSession(): Promise<{
  id: string;
  signedInAt: Date;
} | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session
    ? {
        id: session.session.id,
        signedInAt: new Date(session.session.createdAt),
      }
    : null;
}

/** When the current session was signed in, or null when signed out. */
export async function sessionSignedInAt(): Promise<Date | null> {
  return (await currentSession())?.signedInAt ?? null;
}

/**
 * Whether the current session was signed in recently enough for a sensitive
 * action (`isFreshSession`). A new email link or a passkey makes it fresh.
 */
export async function sessionIsFresh(): Promise<boolean> {
  const signedInAt = await sessionSignedInAt();
  return signedInAt !== null && isFreshSession(signedInAt, new Date());
}
