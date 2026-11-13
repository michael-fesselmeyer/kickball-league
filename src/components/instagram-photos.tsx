import Image from "next/image";
import type { PublicPhoto } from "@/db/queries/social";
import { altFor } from "@/domain/social/sync-plan";

/**
 * Photos from the league's Instagram (docs/architecture.md, section 17):
 * an optional cover, then a grid of squares. Every photo links back to its
 * post. Below the fold, so every image loads lazily at the size its cell
 * needs, and the cells hold their shape so nothing shifts as they arrive.
 * Renders nothing without photos.
 */
export function InstagramPhotos({
  id,
  heading,
  cover,
  photos,
}: {
  id: string;
  heading: string;
  cover: PublicPhoto | null;
  photos: PublicPhoto[];
}) {
  if (!cover && photos.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-h2">
        {heading}
      </h2>
      {cover && (
        <PhotoLink
          photo={cover}
          className="aspect-[4/3] md:aspect-[16/7]"
          sizes="(min-width: 1024px) 1000px, 100vw"
        />
      )}
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.imageId}>
              <PhotoLink
                photo={photo}
                className="aspect-square"
                sizes="(min-width: 1024px) 240px, (min-width: 768px) 25vw, 50vw"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PhotoLink({
  photo,
  className,
  sizes,
}: {
  photo: PublicPhoto;
  className: string;
  sizes: string;
}) {
  return (
    <a
      href={photo.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className={`relative block overflow-hidden rounded-card border-2 border-text bg-surface-2 ${className}`}
    >
      <Image
        src={`/media/instagram/${photo.imageId}`}
        alt={altFor(photo)}
        fill
        sizes={sizes}
        className="object-cover"
      />
      <span className="sr-only"> (opens the post on Instagram)</span>
    </a>
  );
}
