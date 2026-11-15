import { WEEKDAYS } from "@/domain/sponsors/deals";

const input = "rounded-md border border-border bg-surface px-2 py-1";

type Values = {
  title: string;
  terms: string | null;
  validDays: readonly number[];
  validFrom: string | null;
  validTo: string | null;
};

const EMPTY: Values = {
  title: "",
  terms: null,
  validDays: [],
  validFrom: null,
  validTo: null,
};

/** The fields of a deal, for adding one or changing one. */
export function DealFields({
  idPrefix,
  values = EMPTY,
}: {
  idPrefix: string;
  values?: Values;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        What players get
        <input
          name="title"
          required
          maxLength={80}
          defaultValue={values.title}
          placeholder="$2 off any burger"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        Fine print (optional)
        <textarea
          name="terms"
          maxLength={300}
          rows={2}
          defaultValue={values.terms ?? ""}
          placeholder="Show the check-in screen. One per person."
          className={input}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend>Days (none ticked means every day)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAYS.map(([day, name]) => (
            <label
              key={day}
              className="flex min-h-6 items-center gap-2"
              htmlFor={`${idPrefix}-day-${day}`}
            >
              <input
                id={`${idPrefix}-day-${day}`}
                type="checkbox"
                name="day"
                value={day}
                defaultChecked={values.validDays.includes(day)}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Hours (leave both empty for all day)</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1">
            From
            <input
              type="time"
              name="from"
              defaultValue={values.validFrom?.slice(0, 5) ?? ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Until
            <input
              type="time"
              name="to"
              defaultValue={values.validTo?.slice(0, 5) ?? ""}
              className={input}
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}
