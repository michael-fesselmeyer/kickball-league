"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { demoStatus } from "@/lib/demo/guard";

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
