import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/permission";
import { createEventAction } from "../actions";
import { EventFormFields } from "../event-form";

export const metadata: Metadata = { title: "New event" };

const BLANK = {
  kind: "social",
  title: "",
  place: "",
  description: "",
  capacity: "",
  startsOn: "",
  startTime: "19:00",
  endsOn: "",
  endTime: "22:00",
};

export default function NewEventPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/app/admin/events" className="self-start underline">
          Events
        </Link>
        <h1 className="text-h1">New event</h1>
      </header>
      <Suspense fallback={<p className="min-h-svh">Loading…</p>}>
        <NewEvent />
      </Suspense>
    </main>
  );
}

async function NewEvent() {
  await requirePermission("event.manage", { next: "/app/admin/events/new" });
  return (
    <EventFormFields
      action={createEventAction}
      values={BLANK}
      submitLabel="Create event"
    />
  );
}
