import type { MetadataRoute } from "next";
import { env } from "@/env";
import { buildRobots } from "@/lib/seo/sitemap";
import { isIndexable, siteOrigin } from "@/lib/site";

/** /robots.txt: production is indexed; previews and local builds are not. */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteOrigin(env.BETTER_AUTH_URL), isIndexable(process.env));
}
