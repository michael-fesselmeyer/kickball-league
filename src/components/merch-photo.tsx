import { getImageProps } from "next/image";

/**
 * A merch item's photo in a square that holds its shape while it loads.
 * The image optimizer's props are worked out on the server, so no image
 * component JavaScript reaches the page. Admin screens pass `src` for the
 * admin route, which also serves a hidden item's photos.
 */
export function MerchPhoto({
  id,
  alt,
  sizes,
  admin = false,
  priority = false,
}: {
  id: string;
  alt: string;
  sizes: string;
  admin?: boolean;
  priority?: boolean;
}) {
  const src = admin ? `/app/admin/merch/photos/${id}` : `/media/merch/${id}`;
  return (
    <div className="relative aspect-square overflow-hidden rounded-card border-2 border-text bg-surface-2">
      {admin ? (
        // The admin route is private, so it skips the optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img
          {...getImageProps({ src, alt, fill: true, sizes, priority }).props}
          className="object-cover"
        />
      )}
    </div>
  );
}
