import { notFound, redirect } from "next/navigation";
import { parseId, type UserId } from "@/domain/ids";
import { signedInRecently } from "@/domain/platform/operator";
import {
  currentSubject,
  sessionSignedInAt,
  type SignedInSubject,
} from "@/lib/auth/permission";
import { isCurrentOperator } from "./site";

/**
 * The operator console's gate. Everyone else gets a 404, so the console
 * doesn't reveal that it exists; signed-out visitors too.
 */
export async function requireOperator(): Promise<SignedInSubject> {
  const subject = await currentSubject();
  const userId = parseId<UserId>(subject.userId);
  if (userId === null || !isCurrentOperator(userId)) notFound();
  return { ...subject, userId };
}

/** Whether the operator signed in recently enough to change anything. */
export async function operatorIsFresh(): Promise<boolean> {
  return signedInRecently(await sessionSignedInAt(), new Date());
}

/** For actions: the operator, freshly signed in, or back to confirm it's them. */
export async function requireFreshOperator(): Promise<SignedInSubject> {
  const subject = await requireOperator();
  if (!(await operatorIsFresh())) redirect("/operator?error=stale");
  return subject;
}
