"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { countdown } from "@/domain/field-groups/groups";
import type { FieldHandovers } from "./handovers";

const TICK_MS = 15_000;

/** A phone number a person can tap, or null for an email or other words. */
const phoneHref = (contact: string) =>
  /^[\d\s()+.-]{7,}$/.test(contact)
    ? `tel:${contact.replace(/[^\d+]/g, "")}`
    : null;

function Contact({ value }: { value: string }) {
  const href = phoneHref(value);
  return href ? (
    <a href={href} className="inline-flex min-h-11 items-center underline">
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );
}

/**
 * The next handover at each field in use today, with a countdown in the last
 * half hour (issue #408). The list comes from the server for the day; the
 * clock here only moves which handover is "next" and the countdown, so the
 * page needs no polling. Admin-only: it shows the groups' contacts.
 */
export function HandoversCard({
  fields,
  renderedAt,
  timeZone,
}: {
  fields: readonly FieldHandovers[];
  renderedAt: string;
  timeZone: string;
}) {
  const [now, setNow] = useState(() => new Date(renderedAt));
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));

  if (fields.length === 0) return null;
  return (
    <section
      aria-labelledby="handovers"
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <h2 id="handovers" className="text-h3">
        Other groups on the fields
      </h2>
      <ul className="flex flex-col gap-4">
        {fields.map((f) => {
          const next = f.handovers.find(
            (h) => new Date(h.at).getTime() >= now.getTime(),
          );
          const left = next ? countdown(new Date(next.at), now) : null;
          return (
            <li key={f.fieldId} className="flex flex-col gap-1">
              <strong>{f.label}</strong>
              {next ? (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span>
                    {next.kind === "after" &&
                      `Hand over to ${next.group} at ${time(next.at)}`}
                    {next.kind === "before" &&
                      `Take over from ${next.group} at ${time(next.at)}`}
                    {next.kind === "overlap" &&
                      `${next.group} usually uses the field from ${time(next.usual)}, during our hours`}
                  </span>
                  {left !== null && (
                    <span className="sticker tabular-nums" role="timer">
                      {left === 1 ? "in 1 min" : `in ${left} min`}
                    </span>
                  )}
                </p>
              ) : f.handovers.length > 0 ? (
                <p className="text-text-muted">No more handovers today.</p>
              ) : null}
              {next && (
                <p className="text-small text-text-muted">
                  {next.kind === "after" &&
                    `${next.group} usually starts at ${time(next.usual)}.`}
                  {next.kind === "before" &&
                    `${next.group} usually finishes at ${time(next.usual)}.`}
                  {next.contact && (
                    <>
                      {" "}
                      Contact (admins only): <Contact value={next.contact} />
                    </>
                  )}
                </p>
              )}
              {f.noHours.map((g) => (
                <p key={g.group} className="text-small text-text-muted">
                  {g.group} also uses this field; no usual hours on file.
                  {g.contact && (
                    <>
                      {" "}
                      Contact (admins only): <Contact value={g.contact} />
                    </>
                  )}
                </p>
              ))}
              {f.overlaps.length > 0 && (
                <div
                  role="alert"
                  className="flex flex-col gap-1 rounded-md border border-danger p-2"
                >
                  {f.overlaps.map((o) => (
                    <p key={o.group}>
                      <strong>{o.group}</strong> also holds this field today.
                      {o.note && ` ${o.note}`}
                    </p>
                  ))}
                  <p className="text-small">
                    {f.office.phone ? (
                      <>
                        Sort it out with the {f.office.name}:{" "}
                        <a
                          href={`tel:${f.office.phone.replace(/[^\d]/g, "")}`}
                          className="inline-flex min-h-11 items-center underline"
                        >
                          {f.office.phone}
                        </a>
                      </>
                    ) : (
                      <a href={f.office.page} className="underline">
                        Find the borough permit office
                      </a>
                    )}
                  </p>
                </div>
              )}
              {f.incidentGameId && (
                <Link
                  href={`/app/games/${f.incidentGameId}/incident?parkRule=shared_space`}
                  className="inline-flex min-h-11 items-center self-start underline"
                >
                  Log an overlap or handover problem
                  <span className="sr-only"> at {f.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
