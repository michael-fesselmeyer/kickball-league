import { SubmitButton } from "@/components/submit-button";

/** Styles for the gear screens' text fields: a 44px touch target. */
export const FIELD =
  "min-h-11 rounded-md border border-border bg-surface px-2 py-2";

/** The kit's fields, for adding one or changing it. */
export function KitFields({
  action,
  submit,
  kit,
}: {
  action: (form: FormData) => Promise<void>;
  submit: string;
  kit?: { name: string; contents: readonly string[]; homeLocation: string };
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-bold">Name</span>
        <input
          name="name"
          required
          maxLength={40}
          defaultValue={kit?.name}
          placeholder="Kit A"
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-bold">What&apos;s in it</span>
        <span className="text-small text-text-muted" id="contents-hint">
          One item per line, with counts: &ldquo;Bases (4)&rdquo;.
        </span>
        <textarea
          name="contents"
          required
          rows={6}
          aria-describedby="contents-hint"
          defaultValue={kit?.contents.join("\n")}
          placeholder={
            "Ball bag (4 balls)\nBases (4)\nPump\nCones (8)\nFirst-aid kit"
          }
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-bold">Home between game days</span>
        <input
          name="homeLocation"
          required
          maxLength={120}
          defaultValue={kit?.homeLocation}
          placeholder="Storage locker by the park house"
          className={FIELD}
        />
      </label>
      <SubmitButton className="btn self-start btn-primary">
        {submit}
      </SubmitButton>
    </form>
  );
}
