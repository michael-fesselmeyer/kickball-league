"use server";

import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { waitForRequest } from "@/db/wait-for-request";
import { auth } from "@/lib/auth";
import {
  permissionToChange,
  requirePermissionToChange,
} from "@/lib/auth/permission";
import { demoStatus } from "@/lib/demo/guard";
import { localResetAvailable, runLocalReset } from "@/lib/demo/local-reset";
import { PERSONA_KEYS, PERSONAS, type PersonaKey } from "@/lib/demo/personas";

/**
 * One tap from the demo banner: sign in as a seeded persona. With demo mode
 * off this is a 404, and the auth endpoint behind it refuses as well.
 */
export async function viewAs(formData: FormData): Promise<void> {
  if (!demoStatus(process.env).on) notFound();

  let landing: string;
  try {
    ({ landing } = await auth.api.demoViewAs({
      body: { persona: String(formData.get("persona") ?? "") },
      headers: await headers(),
    }));
  } catch (error) {
    if (isAPIError(error) && error.status === "NOT_FOUND") notFound();
    throw error;
  }
  redirect(landing);
}

/**
 * What the demo banner offers the person viewing: admins get the demo's
 * mail and, in the local demo, its reset. Asked from the browser, because
 * the banner sits on public pages that are served as static HTML and never
 * read who is signed in.
 */
export async function demoTools(): Promise<{ mail: boolean; reset: boolean }> {
  if (!demoStatus(process.env).on) return { mail: false, reset: false };
  // An admin may read the demo's mail even while the site is frozen; the
  // reset changes data, so it waits until the site is open again.
  const allowed = await permissionToChange("demo.manage");
  const admin = allowed.ok || allowed.error === "frozen";
  return { mail: admin, reset: allowed.ok && localResetAvailable() };
}

/**
 * "Reset demo": puts the demo league back to fresh seed data, as
 * `npm run demo:reset` does, then drops every cached page so nothing from
 * before shows. The reseed rebuilds the personas, so everyone is signed out.
 */
export async function resetDemo(): Promise<void> {
  if (!demoStatus(process.env).on || !localResetAvailable()) notFound();
  await requirePermissionToChange("demo.manage", { next: "/" });
  const reset = await runLocalReset();
  revalidatePath("/", "layout");
  redirect(reset ? "/" : "/app/admin/demo-mail?reset=failed");
}

/**
 * Which persona this browser is viewing as, for the banner's picker; null
 * when signed out or signed in as anyone else. Asked from the browser, like
 * demoTools, because the banner is part of static pages.
 */
export async function demoPersona(): Promise<PersonaKey | null> {
  if (!demoStatus(process.env).on) return null;
  const requestHeaders = await headers();
  await waitForRequest();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const email = session?.user.email?.toLowerCase();
  if (!email) return null;
  return PERSONA_KEYS.find((key) => PERSONAS[key].email === email) ?? null;
}
