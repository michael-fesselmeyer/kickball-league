import { NextResponse } from "next/server";
import {
  normalizeReferralCode,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
} from "@/domain/money/referral";

/**
 * A player's referral link (/r/<code>). It remembers who sent the visitor
 * in a cookie for 30 days and lands them on the home page; the referral
 * counts when they register for the first time. A code that cannot be one
 * is ignored, so the link never fails.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/r/[code]">,
): Promise<Response> {
  const { code } = await params;
  const response = NextResponse.redirect(new URL("/", request.url), 307);
  response.headers.set("Cache-Control", "private, no-store");
  const valid = normalizeReferralCode(code);
  if (valid)
    response.cookies.set(REFERRAL_COOKIE, valid, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: REFERRAL_COOKIE_DAYS * 86_400,
    });
  return response;
}
