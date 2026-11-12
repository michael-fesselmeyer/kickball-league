import { APP_ICONS, isAppIconName, renderAppIcon } from "@/lib/pwa/icons";

/** The home-screen icons the web app manifest lists, drawn at build time. */
export function generateStaticParams() {
  return Object.keys(APP_ICONS).map((icon) => ({ icon }));
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/icons/[icon]">,
) {
  const { icon } = await ctx.params;
  if (!isAppIconName(icon))
    return new Response("No icon here.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  return renderAppIcon(APP_ICONS[icon]);
}
