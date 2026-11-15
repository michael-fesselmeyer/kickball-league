import { type ShirtSize, sizeLabel } from "@/domain/shirts/summary";

/**
 * The shirt size every sign-up form asks for, from the season's sizes.
 * It starts at the size on the player's profile when the season has it.
 * `id` is unique on the page: the registration page has two forms.
 */
export function ShirtSizeField({
  id,
  sizes,
  defaultValue,
  className = "rounded-md border border-border bg-surface px-2 py-1",
}: {
  id: string;
  sizes: readonly ShirtSize[];
  defaultValue: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>Shirt size</label>
      <select
        id={id}
        name="shirtSize"
        required
        aria-describedby={`${id}-hint`}
        defaultValue={sizes.some((s) => s === defaultValue) ? defaultValue : ""}
        className={`${className} min-h-11 w-40`}
      >
        <option value="" disabled>
          Pick a size
        </option>
        {sizes.map((s) => (
          <option key={s} value={s}>
            {sizeLabel(s)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="text-small text-text-muted">
        For your league shirt. It also goes on your profile.
      </p>
    </div>
  );
}
