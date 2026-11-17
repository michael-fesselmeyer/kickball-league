"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { waitForRequest } from "@/db/wait-for-request";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next";
import { requestSignInLink } from "./request-link";

/**
 * Emails the signed-in person a sign-in link that brings them back to the
 * page they were on, freshly signed in, for a sensitive action
 * (docs/architecture.md, section 4). It changes no league data, so it keeps
 * working while the site is read-only or paused: the operator needs it to
 * confirm before changing the site status back.
 */
export async function emailConfirmLink(form: FormData): Promise<void> {
  const back = safeNextPath(form.get("next"));
  const requestHeaders = await headers();
  await waitForRequest();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  const page = new URL(back, "http://same-site.invalid");
  const outcome = await requestSignInLink(auth.handler, {
    baseURL: env.BETTER_AUTH_URL,
    email: session.user.email,
    callbackURL: back,
    headers: requestHeaders,
  }).catch(() => "failed" as const);
  page.searchParams.set("confirm", outcome === "sent" ? "sent" : "error");
  redirect(`${page.pathname}${page.search}`);
}
