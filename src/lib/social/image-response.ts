/**
 * A stored photo as a response. `nosniff` and a fixed type keep a stored
 * file from ever being treated as anything but an image. `cache` is the
 * `Cache-Control` value, or every cache header (`photoCacheHeaders`).
 */
export function imageResponse(
  image: { contentType: string; bytes: Buffer; sha256: string },
  cache: string | Record<string, string>,
): Response {
  const cacheHeaders =
    typeof cache === "string" ? { "Cache-Control": cache } : cache;
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      ...cacheHeaders,
      ETag: `"${image.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

/**
 * A missing or hidden photo. With its address as `tag`, the CDN's copy of
 * the 404 is purged too when the photo is shown again (ADR 0068).
 */
export const notFound = (tag?: string) =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
      ...(tag ? { "Vercel-Cache-Tag": tag } : {}),
    },
  });
