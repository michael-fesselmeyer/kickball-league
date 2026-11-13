import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { audienceChoices } from "@/db/queries/event-audience";
import { currentLeague } from "@/db/queries/seasons";
import { blankReach } from "@/domain/events/audience";
import { FREE, ticketPriceFormValues } from "@/domain/events/tickets";
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
        <Link
          href="/app/admin/events"
          className="inline-flex min-h-11 items-center self-start underline"
        >
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
  const league = await currentLeague(db);
  if (!league) notFound();
  const choices = await audienceChoices(db, league.id);
  return (
    <EventFormFields
      action={createEventAction}
      values={BLANK}
      reach={blankReach(choices)}
      prices={ticketPriceFormValues(FREE)}
      choices={choices}
      submitLabel="Create event"
      announceLabel="Email everyone it's for"
    />
  );
}
