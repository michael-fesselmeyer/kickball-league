import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { kitForReport } from "@/db/queries/equipment";
import { GEAR_ERRORS, REPORT_NOTE_MAX } from "@/domain/equipment/equipment";
import { type EquipmentKitId, parseId } from "@/domain/ids";
import { requireSelf } from "@/lib/auth/permission";
import { reportMissingAction } from "./actions";

export const metadata: Metadata = { title: "Report missing gear" };

/**
 * "Something missing from Kit A?" (issue #286): tick what wasn't there and
 * add a note. Admins see the report on the kit's page.
 */
export default function MissingPage(
  props: PageProps<"/app/equipment/[kit]/missing">,
) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the kit…</p>}>
        <Missing {...props} />
      </Suspense>
    </main>
  );
}

async function Missing({
  params,
  searchParams,
}: PageProps<"/app/equipment/[kit]/missing">) {
  const { kit: rawKit } = await params;
  await requireSelf("equipment.carry", `/app/equipment/${rawKit}/missing`);
  const kitId = parseId<EquipmentKitId>(rawKit);
  if (!kitId) notFound();
  const kit = await kitForReport(db, kitId);
  if (!kit) notFound();
  const query = await searchParams;
  const error =
    typeof query.error === "string" ? GEAR_ERRORS[query.error] : null;
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app#gear" className="underline">
          Home
        </Link>
        <h1 className="text-h1">Missing from {kit.name}</h1>
        <p className="text-text-muted">
          Tick what wasn&apos;t there, so the league can restock it before the
          next game.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <form
        action={reportMissingAction.bind(null, kit.id)}
        className="flex flex-col gap-4"
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="font-bold">What&apos;s missing?</legend>
          {kit.contents.map((item) => (
            <label key={item} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="missing" value={item} />
              {item}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="font-bold">Note (optional)</span>
          <textarea
            name="note"
            rows={3}
            maxLength={REPORT_NOTE_MAX}
            placeholder="The pump's needle snapped; cones left at Field 2."
            className="rounded-md border border-border bg-surface px-2 py-2"
          />
        </label>
        <SubmitButton className="btn self-start btn-primary">
          Report it
        </SubmitButton>
      </form>
    </>
  );
}
