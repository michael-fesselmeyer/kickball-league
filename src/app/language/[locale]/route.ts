import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { languageSwitchTarget } from "@/i18n/routing";

/**
 * The footer's language links land here (ADR 0094) and go on to the page
 * the visitor came from, in the language they picked: the link's `from`
 * path, else the `Referer`. Working it out on the server keeps the routing
 * tables out of every page's JavaScript.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/language/[locale]">,
) {
  const { locale } = await params;
  const target = languageSwitchTarget(
    {
      from: request.nextUrl.searchParams.get("from"),
      referer: request.headers.get("referer"),
    },
    request.nextUrl.origin,
    isLocale(locale) ? locale : DEFAULT_LOCALE,
  );
  const response = NextResponse.redirect(new URL(target, request.url), 303);
  // Each answer depends on the page the visitor came from.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
