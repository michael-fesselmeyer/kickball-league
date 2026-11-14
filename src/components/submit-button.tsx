"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

/**
 * A form's submit button that can't send the form twice. While the form's
 * action runs it is marked busy and ignores clicks, Enter included (the
 * browser submits with Enter by clicking the default button). It stays
 * focusable, so a keyboard user doesn't lose their place.
 */
export function SubmitButton({
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...props}
      aria-disabled={pending || props["aria-disabled"]}
      data-pending={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
        else onClick?.(event);
      }}
    />
  );
}
