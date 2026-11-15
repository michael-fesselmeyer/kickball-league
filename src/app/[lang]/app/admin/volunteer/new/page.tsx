import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { activeLeague } from "@/lib/league/active";
import { occasionChoices } from "@/db/queries/volunteer";
import { localDay } from "@/domain/schedule/public-game";
import { occasionValue } from "@/domain/volunteer/shifts";
import { requirePermission } from "@/lib/auth/permission";
import { saveShiftAction } from "../actions";
import { ShiftFormFields } from "../shift-form";

export const metadata: Metadata = { title: "Post a shift" };

export default function NewShiftPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin/volunteer"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Volunteer shifts
        </Link>
        <h1 className="text-h1">Post a shift</h1>
      </header>
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <NewShift />
      </Suspense>
    </main>
  );
}

async function NewShift() {
  await requirePermission("volunteer.manage", {
    next: "/app/admin/volunteer/new",
  });
  await connection();
  const league = await activeLeague();
  const now = new Date();
  const choices = league ? await occasionChoices(db, league.id, now) : [];
  if (!league || choices.length === 0)
    return (
      <p>
        Shifts belong to a season&apos;s game day or an event. Add a season or
        an event first.
      </p>
    );
  return (
    <ShiftFormFields
      action={saveShiftAction.bind(null, null)}
      values={{
        role: "setup",
        occasion: "",
        on: localDay(now, league.timeZone),
        starts: "18:00",
        ends: "18:45",
        place: "",
        notes: "",
        spots: "2",
      }}
      occasions={choices.map((c) => ({
        value: occasionValue(c.value),
        label: c.label,
      }))}
      submitLabel="Post the shift"
    />
  );
}
