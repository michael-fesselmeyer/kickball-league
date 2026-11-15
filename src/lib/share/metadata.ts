import type { Metadata } from "next";
import { SHARE_IMAGE_SIZE } from "@/domain/share/cards";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { SITE } from "@/lib/site";

const OPEN_GRAPH_LOCALES = { en: "en_US", es: "es_US" } as const;

/**
 * Open Graph and Twitter tags for a page with a generated share image. A
 * page's openGraph replaces the layout's, so the site-wide fields are
 * repeated here. Paths resolve against the layout's metadataBase.
 */
export function shareMetadata({
  title,
  description,
  path,
  image,
  locale = DEFAULT_LOCALE,
}: {
  title: string;
  description: string;
  /** The page's own address, in its language. */
  path: string;
  image: { path: string; alt: string };
  /** The page's language (ADR 0065); English unless given. */
  locale?: Locale;
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      siteName: SITE.name,
      type: "website",
      locale: OPEN_GRAPH_LOCALES[locale],
      title,
      description,
      url: path,
      images: [
        {
          url: image.path,
          ...SHARE_IMAGE_SIZE,
          alt: image.alt,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image.path, alt: image.alt }],
    },
  };
}
