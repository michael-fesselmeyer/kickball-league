import {
  asDollars,
  itemFormMessage,
  MERCH_KIND_LABEL,
  MERCH_KINDS,
  MERCH_SIZES,
  type MerchKind,
  type MerchSize,
  merchSizeLabel,
} from "@/domain/merch/catalog";
import { SubmitButton } from "@/components/submit-button";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

export type ItemFormValues = {
  kind: MerchKind;
  name: string;
  description: string | null;
  priceCents: number | null;
  memberPriceCents: number | null;
  madeToOrder: boolean;
  /** YYYY-MM-DD in the league's time zone, or "". */
  deadline: string;
  sizes: { size: MerchSize; stock: number; taken?: number }[];
};

export const EMPTY_ITEM: ItemFormValues = {
  kind: "league",
  name: "",
  description: null,
  priceCents: null,
  memberPriceCents: null,
  madeToOrder: false,
  deadline: "",
  sizes: [],
};

/**
 * The admin's form for a merch item: what it is, its price and member
 * price, whether it's made to order or sold from stock, an optional order
 * deadline, and which sizes it comes in with how many the league has.
 */
export function ItemFormFields({
  action,
  values,
  error,
  submit,
}: {
  action: (form: FormData) => Promise<void>;
  values: ItemFormValues;
  error: string | null;
  submit: string;
}) {
  const message = itemFormMessage(error);
  return (
    <form action={action} className="flex flex-col gap-5">
      {message && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {message}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="kind" className="font-bold">
          Kind
        </label>
        <select
          id="kind"
          name="kind"
          defaultValue={values.kind}
          className={control}
        >
          {MERCH_KINDS.map((k) => (
            <option key={k} value={k}>
              {MERCH_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="font-bold">
          Name
        </label>
        <input
          id="name"
          name="name"
          autoComplete="off"
          required
          maxLength={80}
          defaultValue={values.name}
          className={control}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="font-bold">
          Description (optional)
        </label>
        <textarea
          id="description"
          name="description"
          maxLength={500}
          rows={3}
          defaultValue={values.description ?? ""}
          className={`${control} py-2`}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="price" className="font-bold">
            Price in dollars
          </label>
          <input
            id="price"
            name="price"
            required
            inputMode="decimal"
            defaultValue={asDollars(values.priceCents)}
            className={`${control} w-32`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="memberPrice" className="font-bold">
            Member price (optional)
          </label>
          <input
            id="memberPrice"
            name="memberPrice"
            inputMode="decimal"
            aria-describedby="memberPrice-hint"
            defaultValue={asDollars(values.memberPriceCents)}
            className={`${control} w-32`}
          />
          <p id="memberPrice-hint" className="text-small text-text-muted">
            For anyone registered in a season.
          </p>
        </div>
      </div>
      <p className="text-small text-text-muted">
        Stripe&apos;s fee for each card payment comes out of the price.
      </p>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          name="madeToOrder"
          defaultChecked={values.madeToOrder}
          className="size-5 accent-brand"
        />
        Made to order (no stock limit; print after the deadline)
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="deadline" className="font-bold">
          Order deadline (optional)
        </label>
        <input
          id="deadline"
          name="deadline"
          type="date"
          aria-describedby="deadline-hint"
          defaultValue={values.deadline}
          className={`${control} w-48`}
        />
        <p id="deadline-hint" className="text-small text-text-muted">
          Orders close at 11:59 PM that day.
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">Sizes and stock</legend>
        <p className="text-small text-text-muted">
          Stock is how many the league has of that size in all, sold or not.
          Leave it blank for an item made to order.
        </p>
        <div className="overflow-x-auto">
          <table className="text-left">
            <thead className="text-small text-text-muted">
              <tr>
                <th scope="col" className="pr-4">
                  Size
                </th>
                <th scope="col" className="pr-4">
                  Stock
                </th>
                <th scope="col">Sold</th>
              </tr>
            </thead>
            <tbody>
              {MERCH_SIZES.map((size) => {
                const current = values.sizes.find((s) => s.size === size);
                const label = merchSizeLabel(size);
                return (
                  <tr key={size}>
                    <td className="pr-4">
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          name={`size_${size}`}
                          defaultChecked={current !== undefined}
                          className="size-5 accent-brand"
                        />
                        {label}
                      </label>
                    </td>
                    <td className="pr-4">
                      <input
                        name={`stock_${size}`}
                        aria-label={`Stock in ${label}`}
                        inputMode="numeric"
                        defaultValue={
                          current && !values.madeToOrder
                            ? String(current.stock)
                            : ""
                        }
                        className={`${control} w-24`}
                      />
                    </td>
                    <td className="tabular-nums">{current?.taken ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>
      <SubmitButton className="btn self-start btn-primary">
        {submit}
      </SubmitButton>
    </form>
  );
}
