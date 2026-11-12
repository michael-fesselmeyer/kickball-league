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
import type { UserId } from "@/domain/ids";
import { auth } from "./index";

/** The signed-in person as a permissions subject; a visitor when signed out. */
export async function currentSubject(): Promise<Subject> {
  const session = await auth.api.getSession({ headers: await headers() });
  return loadSubject(db, (session?.user.id ?? null) as UserId | null);
}

/**
 * Stops unless the signed-in person may do `action`. Signed-out visitors go
 * to sign-in; anyone else without the right gets a 404, so admin pages do
 * not reveal that they exist.
 */
export async function requirePermission(
  action: Action,
  { next, ...context }: Context & { next: string },
): Promise<Subject & { userId: UserId }> {
  const subject = await currentSubject();
  if (subject.userId === null)
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!can(subject, action, context)) notFound();
  return subject as Subject & { userId: UserId };
}

/**
 * The signed-in person, if they may act on their own record (profile edits,
 * waivers, their own payments). Signed-out visitors go to sign-in.
 */
export async function requireSelf(
  action: Action,
  next: string,
): Promise<Subject & { userId: UserId }> {
  const subject = await currentSubject();
  if (subject.userId === null)
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!can(subject, action, { targetUserId: subject.userId })) notFound();
  return subject as Subject & { userId: UserId };
}
