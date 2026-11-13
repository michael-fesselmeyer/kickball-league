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
import { currentSite, isCurrentOperator } from "@/lib/platform/site";
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
  const site = await currentSite();
  if (!site || canWrite(site.status, isCurrentOperator(subject.userId))) return;
  redirect("/paused");
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

/** When the current session was signed in, or null when signed out. */
export async function sessionSignedInAt(): Promise<Date | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ? new Date(session.session.createdAt) : null;
}
