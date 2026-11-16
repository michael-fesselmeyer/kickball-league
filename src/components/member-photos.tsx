import { getImageProps } from "next/image";
import Link from "next/link";
import type { ApprovedPhoto } from "@/db/queries/member-photos";
import { photoSrc } from "@/lib/media/photo-src";
import { fill } from "@/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

/**
 * Photos players shared and the league approved (ADR 0039), as a grid of
 * squares, with a link to share one. Rendered like the Instagram photos:
 * the image optimizer's props are worked out on the server
 * (`getImageProps`), so the page ships no image component JavaScript, every
 * image loads lazily at the size its cell needs, and the cells hold their
 * shape so nothing shifts as they arrive.
 */
export function MemberPhotos({
  id,
  about,
  photos,
  shareHref,
  locale = DEFAULT_LOCALE,
}: {
  id: string;
  /** What the photos are from, for their alt text: "Sun Kickers". */
  about: string;
  photos: ApprovedPhoto[];
  /** The upload page, with this page's team, event or game chosen. */
  shareHref: string;
  /** The page's language (ADR 0094); English unless given. */
  locale?: Locale;
}) {
  const words = messagesFor(locale).photos;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-h2">
        {words.title}
      </h2>
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id}>
              <figure className="flex flex-col gap-1">
                <div className="relative aspect-square overflow-hidden rounded-card border-2 border-text bg-surface-2">
                  {/* A plain img with the optimizer's srcset: no client component. */}
                  {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                  <img
                    {...imageProps(photo, fill(words.alt, { about }))}
                    className="object-cover"
                  />
                </div>
                {photo.caption && (
                  <figcaption className="line-clamp-2 text-small text-text-muted">
                    {photo.caption}
                  </figcaption>
                )}
              </figure>
            </li>
          ))}
        </ul>
      )}
      <p className="text-small">
        {photos.length === 0 ? `${words.none} ` : ""}
        {words.gotOne}{" "}
        <Link
          href={shareHref}
          prefetch={false}
          className="inline-flex min-h-11 items-center text-brand underline"
        >
          {words.share}
        </Link>
      </p>
    </section>
  );
}

function imageProps(photo: ApprovedPhoto, alt: string) {
  const { props } = getImageProps({
    src: photoSrc.member(photo.id),
    // A caption is shown beside the photo, so it isn't read twice.
    alt: photo.caption ? "" : alt,
    fill: true,
    sizes: "(min-width: 1024px) 240px, (min-width: 768px) 25vw, 50vw",
  });
  return props;
}
