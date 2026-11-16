"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { requestCodeSignIn } from "@/lib/auth/request-code";
import { parseSetCookie, requestGoogleSignIn } from "@/lib/auth/request-google";
import { requestSignInLink } from "@/lib/auth/request-link";
import { normalizeSignInCode } from "@/lib/auth/sign-in-code";
import { safeNextPath } from "@/lib/safe-next";

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string; codeError?: string }
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

/**
 * Signs in with the six-digit code from the sign-in email (ADR 0075), for
 * the apps and for anyone reading their email on another device. Public by
 * design, like the link; guesses are limited per address and per IP.
 */
export async function signInWithCode(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const parsed = z.email().safeParse(email);
  if (!parsed.success)
    return { status: "error", message: "Enter a valid email address.", email };
  const code = normalizeSignInCode(form.get("code"));
  if (!code)
    return {
      status: "sent",
      email,
      codeError: "Enter the 6-digit code from the email.",
    };
  const result = await requestCodeSignIn(auth.handler, {
    baseURL: env.BETTER_AUTH_URL,
    email: parsed.data,
    code,
    headers: await headers(),
  }).catch(() => ({ outcome: "failed" as const }));
  if (result.outcome !== "signed-in")
    return {
      status: "sent",
      email,
      codeError:
        ("message" in result && result.message) ||
        "We couldn't check the code just now. Try again, or use the link.",
    };
  const jar = await cookies();
  for (const header of result.setCookies) {
    const cookie = parseSetCookie(header);
    if (cookie) jar.set(cookie.name, cookie.value, cookie.options);
  }
  redirect(safeNextPath(form.get("next") ?? result.callbackURL));
}

/**
 * Starts Google sign-in through Better Auth's router, so its sign-in rate
 * limit applies, and sends the browser to Google with the state cookie the
 * callback checks.
 */
export async function signInWithGoogle(form: FormData): Promise<void> {
  const next = safeNextPath(form.get("next"));
  const start = await requestGoogleSignIn(auth.handler, {
    baseURL: env.BETTER_AUTH_URL,
    callbackURL: next,
    headers: await headers(),
  }).catch(() => ({ outcome: "failed" as const }));
  if (start.outcome !== "redirect")
    redirect(
      `/sign-in?${new URLSearchParams({ google: start.outcome, next }).toString()}`,
    );
  const jar = await cookies();
  for (const header of start.setCookies) {
    const cookie = parseSetCookie(header);
    if (cookie) jar.set(cookie.name, cookie.value, cookie.options);
  }
  redirect(start.url);
}
