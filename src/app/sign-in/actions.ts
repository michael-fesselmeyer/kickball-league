"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { requestSignInLink } from "@/lib/auth/request-link";
import { safeNextPath } from "@/lib/safe-next";

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string; email: string };

const input = z.object({ email: z.email(), next: z.unknown() });

/**
 * Emails a sign-in link. Public by design: anyone may ask for a link to their
 * own inbox, a few times a minute from one address.
 */
export async function sendSignInLink(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const parsed = input.safeParse({ email, next: form.get("next") });
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address.", email };
  }

  // Through Better Auth's router, so its per-address rate limit applies.
  const outcome = await requestSignInLink(auth.handler, {
    baseURL: env.BETTER_AUTH_URL,
    email: parsed.data.email,
    callbackURL: safeNextPath(parsed.data.next),
    headers: await headers(),
  }).catch(() => "failed" as const);
  if (outcome === "rate_limited")
    return {
      status: "error",
      message: "That's a lot of sign-in links. Wait a minute, then try again.",
      email,
    };
  if (outcome === "failed")
    return {
      status: "error",
      message: "We couldn't send the link just now. Try again in a minute.",
      email,
    };
  return { status: "sent", email: parsed.data.email };
}

/** Starts Google sign-in on the server and sends the browser to Google. */
export async function signInWithGoogle(form: FormData): Promise<void> {
  const { url } = await auth.api.signInSocial({
    body: { provider: "google", callbackURL: safeNextPath(form.get("next")) },
    headers: await headers(),
  });
  if (!url) throw new Error("Google sign-in did not return a URL.");
  redirect(url);
}
