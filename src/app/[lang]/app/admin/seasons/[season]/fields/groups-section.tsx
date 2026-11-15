import type { GroupRow } from "@/db/queries/field-groups";
import {
  type OverlapWarning,
  type RecordedOverlap,
  WEEKDAYS,
} from "@/domain/field-groups/groups";
import { permitOfficeFor } from "@/domain/field-groups/office";
import { SubmitButton } from "@/components/submit-button";
import {
  createGroup,
  createOverlap,
  deleteGroup,
  deleteOverlap,
  editGroup,
} from "./actions";

const input = "rounded-md border border-border bg-surface px-2 py-1";

/** "20:00" → "8:00 pm". */
const clock = (time: string) => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

/** "Tuesdays and Thursdays, 6:00 pm to 8:00 pm", or that the hours aren't known. */
export function usualWords(
  g: Pick<GroupRow, "weekdays" | "startsAt" | "endsAt">,
) {
  if (g.weekdays.length === 0 || !g.startsAt || !g.endsAt)
    return "No usual hours on file";
  const days = g.weekdays.map((d) => `${WEEKDAYS[d]}s`);
  const list =
    days.length === 1
      ? days[0]
      : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  const runsPast = g.endsAt < g.startsAt;
  return `${list}, ${clock(g.startsAt)} to ${clock(g.endsAt)}${runsPast ? " (past midnight)" : ""}`;
}

function HoursFields({ g }: { g?: GroupRow }) {
  return (
    <>
      <fieldset className="flex flex-col gap-1">
        <legend>Usual days (leave all blank if they vary)</legend>
        <div className="flex flex-wrap gap-x-4">
          {WEEKDAYS.map((name, day) => (
            <label key={name} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="weekdays"
                value={day}
                defaultChecked={g?.weekdays.includes(day)}
              />
              {name.slice(0, 3)}
              <span className="sr-only">{name.slice(3)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        Usually from
        <input
          name="startsAt"
          type="time"
          defaultValue={g?.startsAt ?? ""}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        Until (past midnight is fine)
        <input
          name="endsAt"
          type="time"
          defaultValue={g?.endsAt ?? ""}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        Contact (only league admins see this)
        <input
          name="contact"
          autoComplete="off"
          maxLength={200}
          defaultValue={g?.contact ?? ""}
          className={input}
        />
      </label>
    </>
  );
}

/**
 * The warning ahead of a day another group holds the league's time, with the
 * borough permit office's number to sort it out (issue #408).
 */
export function OverlapAlert({
  fields,
  groups,
  warnings,
}: {
  fields: readonly { id: string; label: string }[];
  groups: readonly GroupRow[];
  warnings: readonly OverlapWarning[];
}) {
  const needed = warnings.filter((w) => w.stillNeeded);
  const fieldOf = new Map(groups.map((g) => [g.fieldId, g]));
  const label = new Map(fields.map((f) => [f.id, f.label]));
  if (needed.length === 0) return null;
  return (
    <section
      aria-labelledby="overlap-warnings"
      className="flex flex-col gap-2 rounded-lg border-2 border-danger p-4"
    >
      <h2 id="overlap-warnings" className="text-h3">
        {needed.length === 1
          ? "1 day another group holds our time"
          : `${needed.length} days another group holds our time`}
      </h2>
      <ul className="flex flex-col gap-3">
        {needed.map((w) => {
          const where = fieldOf.get(w.fieldId);
          const office = permitOfficeFor(
            where?.lat != null && where.lng != null
              ? { lat: where.lat, lng: where.lng }
              : null,
            where?.fieldLabel ?? "",
          );
          return (
            <li key={w.id} className="flex flex-col">
              <span>
                <strong>{dayLabel(w.on)}</strong>: {w.group} and the league both
                hold {label.get(w.fieldId) ?? "the field"}.
              </span>
              {w.note && <span className="text-small">{w.note}</span>}
              <span className="text-small">
                {office.phone ? (
                  <>
                    Sort it out with the {office.name}:{" "}
                    <a
                      href={`tel:${office.phone.replace(/[^\d]/g, "")}`}
                      className="underline"
                    >
                      {office.phone}
                    </a>
                    .
                  </>
                ) : (
                  <>
                    Find the right{" "}
                    <a href={office.page} className="underline">
                      borough permit office
                    </a>{" "}
                    to sort it out.
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The other groups that use each field, and the overlap warnings ahead of
 * the day (issue #408). Admin-only: the screen it sits on needs
 * `season.manage`, and it is the only place a group's contact is shown
 * besides the game-day command center.
 */
export function GroupsSection({
  slug,
  fields,
  groups,
  overlaps,
  warnings,
}: {
  slug: string;
  fields: readonly { id: string; label: string }[];
  groups: readonly GroupRow[];
  overlaps: readonly RecordedOverlap[];
  warnings: readonly OverlapWarning[];
}) {
  const label = new Map(fields.map((f) => [f.id, f.label]));
  return (
    <>
      <section aria-labelledby="groups" className="flex flex-col gap-4">
        <h2 id="groups" className="text-h2">
          Other groups on our fields
        </h2>
        <p>
          Who else uses a field before or after the league. The game-day screen
          shows each field&apos;s next handover with a countdown. The contact is
          for league admins only: it never shows on a public page.
        </p>
        {groups.length === 0 ? (
          <p className="text-text-muted">No other groups recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex flex-col gap-1 border-t border-border pt-3"
              >
                <span>
                  <strong>{g.name}</strong>
                  <span className="text-text-muted">
                    {" "}
                    · {g.fieldLabel}, {g.venueName}
                  </span>
                </span>
                <span>{usualWords(g)}</span>
                {g.contact && (
                  <span className="text-small text-text-muted">
                    Contact (admins only): {g.contact}
                  </span>
                )}
                <details>
                  <summary className="min-h-11 cursor-pointer underline">
                    Edit {g.name}
                  </summary>
                  <form
                    action={editGroup.bind(null, slug, g.id)}
                    className="flex flex-col gap-3 py-2"
                  >
                    <label className="flex flex-col gap-1">
                      Group name
                      <input
                        name="name"
                        required
                        maxLength={80}
                        defaultValue={g.name}
                        className={input}
                      />
                    </label>
                    <HoursFields g={g} />
                    <SubmitButton className="btn self-start btn-secondary">
                      Save {g.name}
                    </SubmitButton>
                  </form>
                  <form action={deleteGroup.bind(null, slug, g.id)}>
                    <SubmitButton className="min-h-11 text-danger underline">
                      Remove {g.name}
                    </SubmitButton>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
        {fields.length === 0 ? (
          <p className="text-text-muted">Add a field first.</p>
        ) : (
          <form
            action={createGroup.bind(null, slug)}
            className="flex flex-col gap-3"
          >
            <h3 className="text-h3">Add a group</h3>
            <label className="flex flex-col gap-1">
              Field
              <select name="fieldId" required className={input}>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Group name
              <input
                name="name"
                autoComplete="off"
                required
                maxLength={80}
                className={input}
              />
            </label>
            <HoursFields />
            <SubmitButton className="btn self-start btn-secondary">
              Add group
            </SubmitButton>
          </form>
        )}
      </section>

      {groups.length > 0 && (
        <section aria-labelledby="overlaps" className="flex flex-col gap-4">
          <h2 id="overlaps" className="text-h2">
            Overlaps with other groups
          </h2>
          <p>
            Record a day two groups hold the same time. Admins get a warning
            here, with the borough permit office&apos;s number, until the day.
          </p>
          <form
            action={createOverlap.bind(null, slug)}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              Group
              <select name="groupId" required className={input}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}, {g.fieldLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Date
              <input name="on" type="date" required className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Note
              <input name="note" maxLength={300} className={input} />
            </label>
            <SubmitButton className="btn btn-secondary">
              Record overlap
            </SubmitButton>
          </form>
          {warnings.length === 0 ? (
            <p className="text-text-muted">No overlaps coming up.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {warnings.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-3">
                  <span>
                    <strong>{dayLabel(w.on)}</strong>, {w.group} on{" "}
                    {label.get(w.fieldId)}
                    {!w.stillNeeded && (
                      <span className="text-text-muted">
                        {" "}
                        ·{" "}
                        {w.reason === "rained_out"
                          ? "our games are rained out, nothing to sort out"
                          : w.reason === "blackout"
                            ? "we aren't playing that day"
                            : "we hold no permit there that day"}
                      </span>
                    )}
                  </span>
                  <form action={deleteOverlap.bind(null, slug, w.id)}>
                    <SubmitButton
                      className="min-h-11 text-danger underline"
                      aria-label={`Remove the ${dayLabel(w.on)} overlap with ${w.group}`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {overlaps.length > warnings.length && (
            <p className="text-small text-text-muted">
              Past overlaps are kept out of this list.
            </p>
          )}
        </section>
      )}
    </>
  );
}
