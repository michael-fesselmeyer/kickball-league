import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { gamesOnLostPermits } from "@/db/queries/books";
import { fieldsScreen } from "@/db/queries/fields";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { localDate } from "@/domain/scheduler/slots";
import { localTime } from "@/domain/time/zoned";
import { requirePermission } from "@/lib/auth/permission";
import {
  changePermitStatus,
  createBlackout,
  createField,
  createPermits,
  createVenue,
  cutSlots,
  deleteBlackout,
  deletePermit,
} from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Fields and permits" };

export default function FieldsPage(
  props: PageProps<"/app/admin/seasons/[season]/fields">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Fields {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  venue_invalid_name:
    "Give the venue a name with at least one letter or digit.",
  venue_duplicate: "There is already a venue with that name.",
  field_invalid_name: "Give the field a name.",
  field_unknown_venue: "Pick one of the league's venues.",
  field_duplicate: "That venue already has a field with that name.",
  permit_bad_input:
    "Check the permit: a first date, 1 to 26 weeks, start and end times, and a status.",
  permit_unknown_field: "Pick one of the league's fields.",
  permit_no_dates: "Add at least one date.",
  permit_end_before_start: "The permit must end after it starts.",
  permit_unknown_permit: "That permit is gone. It may have just been deleted.",
  permit_has_slots:
    "Slots were cut from that permit, so it cannot be deleted. Mark it lost and cut slots again instead.",
  blackout_bad_date: "Pick a date for the blackout.",
  blackout_unknown_field: "Pick one of the league's fields, or all fields.",
  blackout_duplicate: "That blackout is already there.",
  blackout_unknown_blackout: "That blackout is gone.",
  slots_bad_length: "A slot is 15 to 480 minutes long.",
};

const NOTICES: Record<string, (q: Record<string, string>) => string> = {
  venue_added: () => "Venue added.",
  field_added: () => "Field added.",
  permits_added: (q) =>
    `${plural(Number(q.count), "permit window")} added. Cut slots to use them.`,
  permit_updated: () => "Permit updated. Cut slots again to apply it.",
  permit_deleted: () => "Permit deleted.",
  blackout_added: () => "Blackout added. Cut slots again to apply it.",
  blackout_deleted: () => "Blackout removed. Cut slots again to apply it.",
  slots_synced: (q) =>
    [
      `${plural(Number(q.added), "slot")} added, ${Number(q.kept)} kept and ${Number(q.removed)} removed.`,
      Number(q.retired) > 0
        ? `${plural(Number(q.retired), "slot")} a schedule uses could not be removed, so ${Number(q.retired) === 1 ? "it was" : "they were"} cancelled instead. Move the games in them on the schedule screen, or call a rain-out.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
};

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

/** "20:00" → "8:00 pm". */
const clock = (time: string) => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

const input = "rounded-md border border-border bg-surface px-2 py-1";

async function Fields({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/fields">) {
  const { season: slug } = await params;
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  const page = `/app/admin/seasons/${slug}/fields`;
  await requirePermission("season.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();

  const [screen, lostGames] = await Promise.all([
    fieldsScreen(db, season.leagueId, season.id),
    gamesOnLostPermits(db, season.id),
  ]);
  const tz = season.timeZone;
  const fieldName = new Map(
    screen.fields.map((f) => [f.id, `${f.name}, ${f.venueName}`]),
  );
  const slotsPerPermit = new Map<string, number>();
  for (const s of screen.slots)
    if (s.permitWindowId)
      slotsPerPermit.set(
        s.permitWindowId,
        (slotsPerPermit.get(s.permitWindowId) ?? 0) + 1,
      );
  const lengths = screen.slots.map(
    (s) => (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000,
  );
  const slotMinutes = lengths[0] ?? 60;
  const slotDays = Map.groupBy(screen.slots, (s) => localDate(s.startsAt, tz));
  const openSlots = screen.slots.filter((s) => s.status === "open").length;

  const error = query.error ? ERRORS[query.error] : undefined;
  const notice = query.notice ? NOTICES[query.notice]?.(query) : undefined;
  const noFields = screen.fields.length === 0;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{season.name}</p>
        <h1 className="text-h1">Fields and permits</h1>
        <p>
          Add where the league plays and when it holds the fields, then cut the
          permits into game slots for the{" "}
          <Link
            href={`/app/admin/seasons/${slug}/schedule`}
            className="underline"
          >
            schedule
          </Link>
          . Times are in {tz.replace("_", " ")}.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}

      {lostGames.length > 0 && (
        <section
          aria-labelledby="lost"
          className="flex flex-col gap-2 rounded-lg border-2 border-danger p-4"
        >
          <h2 id="lost" className="text-h3">
            {lostGames.length === 1
              ? "1 game is on a lost permit"
              : `${lostGames.length} games are on a lost permit`}
          </h2>
          <ul className="flex flex-col">
            {lostGames.map((g) => (
              <li key={g.id}>
                {g.teamA} vs {g.teamB}, {localDate(g.startsAt, tz)} at{" "}
                {localTime(g.startsAt, tz)}, {g.fieldName}
              </li>
            ))}
          </ul>
          <Link
            href={`/app/admin/seasons/${slug}/schedule`}
            className="btn self-start btn-primary"
          >
            Move them on the schedule board
          </Link>
        </section>
      )}

      <section aria-labelledby="venues" className="flex flex-col gap-4">
        <h2 id="venues" className="text-h2">
          Venues and fields
        </h2>
        {screen.venues.length === 0 ? (
          <p className="text-text-muted">No venues yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {screen.venues.map((v) => (
              <li key={v.id}>
                <strong>{v.name}</strong>
                {v.neighborhood && (
                  <span className="text-text-muted"> · {v.neighborhood}</span>
                )}
                {v.address && (
                  <span className="text-text-muted"> · {v.address}</span>
                )}
                <p>
                  {v.fields.length === 0
                    ? "No fields yet."
                    : v.fields.map((f) => f.name).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form
          action={createVenue.bind(null, slug)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            Venue name
            <input name="name" required maxLength={80} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            Neighborhood
            <input name="neighborhood" maxLength={80} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            Address
            <input name="address" maxLength={160} className={input} />
          </label>
          <SubmitButton className="btn btn-secondary">Add venue</SubmitButton>
        </form>
        {screen.venues.length > 0 && (
          <form
            action={createField.bind(null, slug)}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              Venue
              <select name="venueId" required className={input}>
                {screen.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Field name
              <input name="name" required maxLength={80} className={input} />
            </label>
            <SubmitButton className="btn btn-secondary">Add field</SubmitButton>
          </form>
        )}
      </section>

      <section aria-labelledby="permits" className="flex flex-col gap-4">
        <h2 id="permits" className="text-h2">
          Permit windows
        </h2>
        {noFields ? (
          <p className="text-text-muted">Add a field first.</p>
        ) : (
          <form
            action={createPermits.bind(null, slug)}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              Field
              <select name="fieldId" required className={input}>
                {screen.fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {fieldName.get(f.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              First date
              <input
                name="firstDate"
                type="date"
                required
                defaultValue={season.startsOn}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              Weeks
              <input
                name="weeks"
                type="number"
                min={1}
                max={26}
                defaultValue={1}
                required
                className={`${input} w-20`}
              />
            </label>
            <label className="flex flex-col gap-1">
              From
              <input
                name="startTime"
                type="time"
                required
                defaultValue="20:00"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              To
              <input
                name="endTime"
                type="time"
                required
                defaultValue="22:00"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              Permit number
              <input name="permitNumber" maxLength={40} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Status
              <select name="status" defaultValue="requested" className={input}>
                <option value="requested">Requested</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </label>
            <SubmitButton className="btn btn-secondary">
              Add permit hours
            </SubmitButton>
          </form>
        )}
        {screen.permits.length === 0 ? (
          <p className="text-text-muted">No permit windows yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Field</th>
                  <th scope="col">Permit</th>
                  <th scope="col">Slots</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {screen.permits.map((p) => {
                  const slots = slotsPerPermit.get(p.id) ?? 0;
                  const date = dayLabel(localDate(p.startsAt, tz));
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td>{date}</td>
                      <td>
                        {clock(localTime(p.startsAt, tz))} to{" "}
                        {clock(localTime(p.endsAt, tz))}
                      </td>
                      <td>{fieldName.get(p.fieldId)}</td>
                      <td>{p.permitNumber ?? "—"}</td>
                      <td>{slots}</td>
                      <td>
                        <form
                          action={changePermitStatus.bind(null, slug, p.id)}
                          className="flex items-center gap-2"
                        >
                          <select
                            name="status"
                            defaultValue={p.status}
                            aria-label={`Status of the ${date} permit on ${fieldName.get(p.fieldId)}`}
                            className={input}
                          >
                            <option value="requested">Requested</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="lost">Lost</option>
                          </select>
                          <SubmitButton className="underline">
                            Save
                          </SubmitButton>
                        </form>
                      </td>
                      <td>
                        {slots === 0 && (
                          <form action={deletePermit.bind(null, slug, p.id)}>
                            <SubmitButton
                              className="text-danger underline"
                              aria-label={`Delete the ${date} permit on ${fieldName.get(p.fieldId)}`}
                            >
                              Delete
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="blackouts" className="flex flex-col gap-4">
        <h2 id="blackouts" className="text-h2">
          Blackout dates
        </h2>
        <form
          action={createBlackout.bind(null, slug)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            Date
            <input name="onDate" type="date" required className={input} />
          </label>
          <label className="flex flex-col gap-1">
            Field
            <select name="fieldId" defaultValue="" className={input}>
              <option value="">All fields</option>
              {screen.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {fieldName.get(f.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Reason
            <input name="reason" maxLength={120} className={input} />
          </label>
          <SubmitButton className="btn btn-secondary">
            Add blackout
          </SubmitButton>
        </form>
        {screen.blackouts.length === 0 ? (
          <p className="text-text-muted">No blackout dates.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {screen.blackouts.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3">
                <span>
                  <strong>{dayLabel(b.onDate)}</strong>,{" "}
                  {b.fieldId ? fieldName.get(b.fieldId) : "all fields"}
                  {b.reason && (
                    <span className="text-text-muted"> · {b.reason}</span>
                  )}
                </span>
                <form action={deleteBlackout.bind(null, slug, b.id)}>
                  <SubmitButton
                    className="text-danger underline"
                    aria-label={`Remove the ${dayLabel(b.onDate)} blackout`}
                  >
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="slots" className="flex flex-col gap-4">
        <h2 id="slots" className="text-h2">
          Game slots
        </h2>
        <p>
          Requested and confirmed permits are cut into back-to-back slots; lost
          permits and blackout dates are skipped. Slots a schedule already uses
          keep their place.
        </p>
        <form
          action={cutSlots.bind(null, slug)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            Minutes per slot
            <input
              name="slotMinutes"
              type="number"
              min={15}
              max={480}
              step={5}
              required
              defaultValue={slotMinutes}
              className={`${input} w-24`}
            />
          </label>
          <SubmitButton className="btn btn-primary">
            Cut slots from permits
          </SubmitButton>
        </form>
        <p>
          <strong>{plural(openSlots, "open slot")}</strong> on{" "}
          {plural(slotDays.size, "date")}
          {screen.slots.length > openSlots &&
            `, and ${screen.slots.length - openSlots} cancelled`}
          .
        </p>
        {slotDays.size > 0 && (
          <ul className="flex flex-col gap-1">
            {[...slotDays].map(([date, slots]) => {
              const times = Map.groupBy(slots, (s) =>
                localTime(s.startsAt, tz),
              );
              return (
                <li key={date}>
                  <strong>{dayLabel(date)}</strong>:{" "}
                  {[...times]
                    .map(([time, at]) => {
                      const cancelled = at.filter(
                        (s) => s.status === "cancelled",
                      ).length;
                      return `${clock(time)} on ${plural(at.length, "field")}${cancelled ? ` (${cancelled} cancelled)` : ""}`;
                    })
                    .join(", ")}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
