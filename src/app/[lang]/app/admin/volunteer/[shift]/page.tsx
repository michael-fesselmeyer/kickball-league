import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { activeLeague } from "@/lib/league/active";
import { occasionChoices, shiftById } from "@/db/queries/volunteer";
import { parseId, type VolunteerShiftId } from "@/domain/ids";
import {
  occasionValue,
  ROLE_LABELS,
  shiftFormValues,
} from "@/domain/volunteer/shifts";
import { requirePermission } from "@/lib/auth/permission";
import { deleteShiftAction, saveShiftAction } from "../actions";
import { ShiftFormFields } from "../shift-form";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Edit a shift" };

type Props = PageProps<"/[lang]/app/admin/volunteer/[shift]">;

export default function EditShiftPage(props: Props) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <EditShift {...props} />
      </Suspense>
    </main>
  );
}

async function EditShift({ params, searchParams }: Props) {
  const { shift: raw } = await params;
  const query = await searchParams;
  await requirePermission("volunteer.manage", {
    next: `/app/admin/volunteer/${raw}`,
  });
  await connection();
  const id = parseId<VolunteerShiftId>(raw);
  const league = await activeLeague();
  if (!id || !league) notFound();
  const [shift, choices] = await Promise.all([
    shiftById(db, id),
    occasionChoices(db, league.id, new Date()),
  ]);
  if (!shift) notFound();
  const current = occasionValue(shift.occasion);
  const options = choices.map((c) => ({
    value: occasionValue(c.value),
    label: c.label,
  }));
  // A finished season or past event stays selectable on its own shift.
  if (!options.some((o) => o.value === current))
    options.unshift({ value: current, label: shift.occasionName });
  const label = `${ROLE_LABELS[shift.role]}, ${shift.occasionName}`;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin/volunteer"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Volunteer shifts
        </Link>
        <h1 className="text-h1">{label}</h1>
        <p className="text-text-muted">
          {shift.taken} of {shift.spots} signed up.
        </p>
      </header>
      <ShiftFormFields
        action={saveShiftAction.bind(null, shift.id)}
        values={shiftFormValues(shift, league.timeZone)}
        occasions={options}
        submitLabel="Save the shift"
      />
      <section
        aria-labelledby="remove"
        className="flex flex-col gap-2 rounded-card border-2 border-border p-4"
      >
        <h2 id="remove" className="text-h3">
          Remove this shift
        </h2>
        {query.error === "confirm" && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            Tick the box to confirm.
          </p>
        )}
        <form
          action={deleteShiftAction.bind(null, shift.id)}
          className="flex flex-col gap-2"
        >
          <label className="check-row">
            <input
              type="checkbox"
              name="confirm"
              value="yes"
              className="size-5"
            />
            {shift.taken > 0
              ? `Remove it and the ${shift.taken} ${shift.taken === 1 ? "person" : "people"} signed up`
              : "Remove it"}
          </label>
          <SubmitButton className="btn self-start btn-secondary">
            Remove the shift
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
