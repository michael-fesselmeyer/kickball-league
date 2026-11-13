/**
 * A stored Instagram photo as a response. `nosniff` and a fixed type keep a
 * stored file from ever being treated as anything but an image.
 */
export function imageResponse(
  image: { contentType: string; bytes: Buffer; sha256: string },
  cacheControl: string,
): Response {
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": cacheControl,
      ETag: `"${image.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

export const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  });
