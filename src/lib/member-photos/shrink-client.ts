// Browser only: imported by client components that upload a photo.

/** The longest edge the phone sends; the server stores at most 1440. */
const SEND_LONG_EDGE = 2048;
/** Smaller files go as they are. */
const SHRINK_OVER_BYTES = 1_500_000;

/**
 * Shrinks a phone photo before it is sent, so a 5–10 MB camera file goes up
 * as a few hundred kilobytes on a weak signal. Drawing it on a canvas also
 * leaves its metadata behind; the server strips it again either way. When
 * the browser can't decode the file, the original goes and the server says
 * what is wrong with it.
 */
export async function shrink(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(
      1,
      SEND_LONG_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
