import type { Metadata } from "next";
import { SHARE_IMAGE_SIZE } from "@/domain/share/cards";
import { SITE } from "@/lib/site";

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
}: {
  title: string;
  description: string;
  path: string;
  image: { path: string; alt: string };
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      siteName: SITE.name,
      type: "website",
      locale: "en_US",
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
