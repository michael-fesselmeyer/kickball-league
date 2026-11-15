"use server";

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { signOutDevice, signOutOtherDevices } from "@/db/queries/devices";
import { removePasskey, renamePasskey } from "@/db/queries/passkeys";
import {
  currentSession,
  requireSelfToChange,
  sessionIsFresh,
} from "@/lib/auth/permission";
import { demoStatus } from "@/lib/demo/guard";

const PAGE = "/app/profile/security";

const back = (query: string): never => redirect(`${PAGE}?${query}`);

/**
 * The person, signed in, on their own account, with their current session.
 * Signing devices out is off in the demo, whose personas every visitor
 * shares; passkeys work there, so visitors can try them.
 */
async function me({ demo }: { demo: "allow" | "refuse" }) {
  const subject = await requireSelfToChange("profile.edit", PAGE);
  if (demo === "refuse" && demoStatus(process.env).on) back("error=demo");
  const session = await currentSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
  return { userId: subject.userId, sessionId: session.id };
}

/** Signs one of the person's other devices out. */
export async function signOutDeviceAction(form: FormData): Promise<void> {
  const { userId, sessionId } = await me({ demo: "refuse" });
  const id = String(form.get("session") ?? "");
  const done = await signOutDevice(db, userId, id, sessionId);
  back(done ? "done=device" : "error=device");
}

/** Signs out every device but this one. */
export async function signOutOtherDevicesAction(): Promise<void> {
  const { userId, sessionId } = await me({ demo: "refuse" });
  await signOutOtherDevices(db, userId, sessionId);
  back("done=others");
}

export async function renamePasskeyAction(form: FormData): Promise<void> {
  const { userId } = await me({ demo: "allow" });
  const done = await renamePasskey(
    db,
    userId,
    String(form.get("passkey") ?? ""),
    String(form.get("name") ?? ""),
  );
  back(done ? "done=renamed" : "error=passkey");
}

/**
 * Removing a passkey takes a way of signing in away, so, like adding one,
 * it needs a fresh sign-in.
 */
export async function removePasskeyAction(form: FormData): Promise<void> {
  const { userId } = await me({ demo: "allow" });
  if (!(await sessionIsFresh())) back("error=stale");
  const done = await removePasskey(
    db,
    userId,
    String(form.get("passkey") ?? ""),
  );
  back(done ? "done=removed" : "error=passkey");
}
