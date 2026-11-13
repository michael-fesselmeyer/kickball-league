"use client";

import { type ChangeEvent, useState } from "react";

/** Phone photos are shrunk to this before upload; the server resizes again. */
const UPLOAD_EDGE = 2000;
const PDF_MAX_BYTES = 1024 * 1024;

/**
 * A file field for a receipt photo or a permit document. On a phone the
 * picker offers the camera as well as saved photos (no `capture`, which
 * would hide the saved ones). A photo is shrunk in the browser before it is sent, so
 * a large camera image uploads quickly on a weak signal; without
 * JavaScript the original is sent and the server shrinks it instead.
 */
export function FileInput({
  name,
  label,
  hint,
  camera = false,
}: {
  name: string;
  label: string;
  hint: string;
  camera?: boolean;
}) {
  const [status, setStatus] = useState("");
  const hintId = `${name}-hint`;

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    input.setCustomValidity("");
    const file = input.files?.[0];
    setStatus("");
    if (!file) return;
    if (file.type === "application/pdf") {
      if (file.size > PDF_MAX_BYTES) {
        input.setCustomValidity("That PDF is over 1 MB. Save it smaller.");
        input.reportValidity();
      }
      return;
    }
    if (!file.type.startsWith("image/")) return;
    try {
      const smaller = await shrink(file);
      if (smaller && smaller.size < file.size) {
        const files = new DataTransfer();
        files.items.add(smaller);
        input.files = files.files;
      }
      setStatus("Photo ready.");
    } catch {
      // The server resizes it anyway.
    }
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-small">{label}</span>
      <input
        type="file"
        name={name}
        accept={camera ? "image/*" : "image/*,application/pdf"}
        onChange={onChange}
        aria-describedby={hintId}
        className="min-h-11 rounded-md border border-border bg-surface px-2 py-2"
      />
      <span id={hintId} className="text-small text-text-muted">
        {hint}
      </span>
      <span role="status" className="text-small text-text-muted">
        {status}
      </span>
    </label>
  );
}

async function shrink(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(
    1,
    UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) return null;
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
