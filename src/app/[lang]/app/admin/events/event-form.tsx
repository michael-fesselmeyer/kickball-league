"use client";

import { useActionState, useId, useState } from "react";
import {
  AUDIENCE_KINDS,
  type AudienceChoices,
  inAppRsvpByDefault,
  MAX_INVITE_URL_LENGTH,
  type ReachForm,
} from "@/domain/events/audience";
import {
  EVENT_KINDS,
  type EventForm,
  KIND_LABELS,
  MAX_CAPACITY,
  MAX_DESCRIPTION_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_TITLE_LENGTH,
} from "@/domain/events/event";
import type { TicketPriceForm } from "@/domain/events/tickets";
import { OVERRIDE_REASON_MAX } from "@/domain/permits/coverage";
import type { EventFormState } from "./actions";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

/**
 * A labelled control with an optional hint. The hint sits outside the label
 * and is tied to the control with aria-describedby, so the field's name stays
 * short ("Place") and the hint is read after it.
 */
function Field({
  label,
  hint,
  hidden,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  hidden?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`flex flex-col gap-1 ${className}`} hidden={hidden}>
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      {children(hint ? { id, "aria-describedby": hintId } : { id })}
      {hint && (
        <p id={hintId} className="text-small text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

const AUDIENCE_OPTIONS: Readonly<
  Record<(typeof AUDIENCE_KINDS)[number], { label: string; hint: string }>
> = {
  public: {
    label: "Everyone",
    hint: "On the public events page and calendar feed.",
  },
  members: {
    label: "All members",
    hint: "Anyone registered in any season, once they sign in.",
  },
  teams: {
    label: "Chosen teams",
    hint: "Only the players on the teams you pick, once they sign in.",
  },
};

/**
 * Who the event is for. Picking teams shows a season (the active one first)
 * or any season, and that season's teams. Only the boxes on screen are
 * sent, so a team picked under another season is left out.
 */
function AudienceFields({
  choices,
  reach,
}: {
  choices: AudienceChoices;
  reach: ReachForm;
}) {
  const id = useId();
  const [audience, setAudience] = useState(reach.audience);
  const [season, setSeason] = useState(reach.season);
  const [picked, setPicked] = useState(() => new Set(reach.teams));
  const teams =
    season === "all"
      ? choices.teams
      : (choices.seasons.find((s) => s.id === season)?.teams ?? []);
  const toggle = (teamId: string, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(teamId);
      else next.delete(teamId);
      return next;
    });
  return (
    <fieldset className="flex flex-col gap-3 rounded-card border border-border p-4">
      <legend className="px-1 font-bold">Who it&apos;s for</legend>
      <div className="flex flex-col gap-1">
        {AUDIENCE_KINDS.map((kind) => (
          <label key={kind} className="flex min-h-11 items-start gap-2 py-1">
            <input
              type="radio"
              name="audience"
              value={kind}
              checked={audience === kind}
              onChange={() => setAudience(kind)}
              aria-describedby={`${id}-${kind}`}
              className="mt-1 size-5 accent-brand"
            />
            <span className="flex flex-col">
              {AUDIENCE_OPTIONS[kind].label}
              <span id={`${id}-${kind}`} className="text-small text-text-muted">
                {AUDIENCE_OPTIONS[kind].hint}
              </span>
            </span>
          </label>
        ))}
      </div>
      {audience === "teams" && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-season`} className="font-bold">
              Season
            </label>
            <select
              id={`${id}-season`}
              name="season"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className={control}
            >
              {choices.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === choices.activeSeasonId ? " (active)" : ""}
                </option>
              ))}
              <option value="all">Any season</option>
            </select>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-bold">Teams</legend>
            {teams.length === 0 ? (
              <p className="text-small text-text-muted">
                No teams in this season yet.
              </p>
            ) : (
              <div className="grid gap-x-4 sm:grid-cols-2">
                {teams.map((t) => (
                  <label
                    key={t.id}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      name="team"
                      value={t.id}
                      checked={picked.has(t.id)}
                      onChange={(e) => toggle(t.id, e.target.checked)}
                      className="size-5 accent-brand"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </>
      )}
    </fieldset>
  );
}

/**
 * The admin's event form. A theme week needs only its days, so the time,
 * capacity and audience fields hide while it is picked (theme weeks are for
 * everyone). Hidden fields are still sent and ignored, so switching back
 * keeps what was typed.
 *
 * An invite link takes the RSVPs: typing one unticks "RSVPs in the app",
 * and clearing it ticks the box again, until the admin sets the box
 * themselves (inAppRsvpByDefault).
 */
export function EventFormFields({
  action,
  values,
  reach,
  prices,
  choices,
  fields = [],
  hasRsvps = false,
  submitLabel,
  announceLabel,
}: {
  action: (previous: EventFormState, form: FormData) => Promise<EventFormState>;
  values: EventForm;
  reach: ReachForm;
  prices: TicketPriceForm;
  choices: AudienceChoices;
  /** The league's fields, for something played at a park (issue #407). */
  fields?: readonly { id: string; label: string }[];
  /** People have RSVP'd in the app, so RSVPs there stay on. */
  hasRsvps?: boolean;
  submitLabel: string;
  announceLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    values,
    reach,
    prices,
    announce: false,
    error: null,
  });
  const v = state.values;
  const [kind, setKind] = useState(v.kind);
  const themeWeek = kind === "theme_week";
  const [inviteUrl, setInviteUrl] = useState(state.reach.inviteUrl);
  const [price, setPrice] = useState(state.prices.price);
  const [inAppRsvp, setInAppRsvp] = useState(state.reach.inAppRsvp === "yes");
  const [inAppSet, setInAppSet] = useState(false);
  const inAppHintId = useId();
  const follow = (next: { inviteUrl: string; price: string }) => {
    if (!inAppSet)
      setInAppRsvp(
        inAppRsvpByDefault({
          inviteUrl: next.inviteUrl,
          ticketed: next.price.trim() !== "",
          hasRsvps,
        }),
      );
  };
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {state.error}
        </p>
      )}
      <Field label="Kind">
        {(props) => (
          <select
            {...props}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={control}
          >
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Name">
        {(props) => (
          <input
            {...props}
            name="title"
            required
            maxLength={MAX_TITLE_LENGTH}
            defaultValue={v.title}
            className={control}
          />
        )}
      </Field>
      <Field
        label="Place"
        hint={`A name and address, such as "The Example Tavern, 123 Example St". Optional for a theme week.`}
      >
        {(props) => (
          <input
            {...props}
            name="place"
            maxLength={MAX_PLACE_LENGTH}
            defaultValue={v.place}
            className={control}
          />
        )}
      </Field>
      {fields.length > 0 && (
        <Field
          label="Field"
          hidden={themeWeek}
          hint="For a pickup game, a practice or anything else on a league field. Saving checks that a permit with its document covers the field for the whole time."
        >
          {(props) => (
            <select
              {...props}
              name="fieldId"
              defaultValue={v.fieldId ?? ""}
              className={control}
            >
              <option value="">Not on a league field</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <label className="flex min-h-11 items-center gap-3" hidden={themeWeek}>
        <input
          type="checkbox"
          name="openPlay"
          defaultChecked={v.openPlay === "on"}
          className="size-5"
        />
        <span>
          Open play, no reserved field
          <span className="block text-small text-text-muted">
            The event page says so, and nothing is checked against a permit.
          </span>
        </span>
      </label>
      {fields.length > 0 && (
        <details hidden={themeWeek} className="flex flex-col gap-1">
          <summary className="cursor-pointer font-bold">
            Permit document still to come
          </summary>
          <Field
            label="Why post it before the permit's document is uploaded?"
            hint="Only when the league holds the permit and an owner will upload it. The reason goes in the audit log."
          >
            {(props) => (
              <textarea
                {...props}
                name="permitOverride"
                rows={2}
                maxLength={OVERRIDE_REASON_MAX}
                className={`${control} py-2`}
              />
            )}
          </Field>
        </details>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={themeWeek ? "First day" : "Date"}>
          {(props) => (
            <input
              {...props}
              type="date"
              name="startsOn"
              required
              defaultValue={v.startsOn}
              className={control}
            />
          )}
        </Field>
        <Field
          label={themeWeek ? "Last day" : "End date (optional)"}
          hint={
            themeWeek
              ? "Blank for a one-day theme."
              : "Only for an event that runs over more than one night."
          }
        >
          {(props) => (
            <input
              {...props}
              type="date"
              name="endsOn"
              defaultValue={v.endsOn}
              className={control}
            />
          )}
        </Field>
        <Field label="Starts at" hidden={themeWeek}>
          {(props) => (
            <input
              {...props}
              type="time"
              name="startTime"
              defaultValue={v.startTime}
              className={control}
            />
          )}
        </Field>
        <Field
          label="Ends at"
          hint="An end time earlier than the start runs past midnight."
          hidden={themeWeek}
        >
          {(props) => (
            <input
              {...props}
              type="time"
              name="endTime"
              defaultValue={v.endTime}
              className={control}
            />
          )}
        </Field>
      </div>
      <Field
        label="Capacity (optional)"
        hint="Leave blank for no limit. When it fills, players can join a waitlist."
        hidden={themeWeek}
      >
        {(props) => (
          <input
            {...props}
            type="number"
            name="capacity"
            min={1}
            max={MAX_CAPACITY}
            inputMode="numeric"
            defaultValue={v.capacity}
            className={`${control} sm:max-w-40`}
          />
        )}
      </Field>
      <fieldset
        className="flex flex-col gap-3 rounded-card border border-border p-4"
        hidden={themeWeek}
      >
        <legend className="px-1 font-bold">Tickets</legend>
        <p className="text-small text-text-muted">
          Leave the price blank for a free RSVP. With a price, players buy a
          ticket by card or league credit, and the capacity counts tickets.
          Stripe&apos;s fee comes out of each ticket.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Ticket price (optional)"
            hint="In dollars, such as 15 or 12.50."
          >
            {(props) => (
              <input
                {...props}
                name="price"
                inputMode="decimal"
                autoComplete="off"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  follow({ inviteUrl, price: e.target.value });
                }}
                className={control}
              />
            )}
          </Field>
          <Field
            label="Member price (optional)"
            hint="For anyone registered in any season. 0 makes it free for members."
          >
            {(props) => (
              <input
                {...props}
                name="memberPrice"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={state.prices.memberPrice}
                className={control}
              />
            )}
          </Field>
        </div>
      </fieldset>
      <Field label="Description">
        {(props) => (
          <textarea
            {...props}
            name="description"
            rows={6}
            maxLength={MAX_DESCRIPTION_LENGTH}
            defaultValue={v.description}
            className="rounded-input border border-border-strong bg-surface px-3 py-2 text-body"
          />
        )}
      </Field>
      <Field
        label="Invite link (optional)"
        hint="A Partiful invite or any https:// page. Players RSVP there, so its guest list is the one that counts. The app shows the link and shares it, and never reads it."
      >
        {(props) => (
          <input
            {...props}
            type="url"
            name="inviteUrl"
            inputMode="url"
            maxLength={MAX_INVITE_URL_LENGTH}
            placeholder="https://"
            value={inviteUrl}
            onChange={(e) => {
              setInviteUrl(e.target.value);
              follow({ inviteUrl: e.target.value, price });
            }}
            className={control}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1" hidden={themeWeek}>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="inAppRsvp"
            value="yes"
            checked={inAppRsvp}
            onChange={(e) => {
              setInAppRsvp(e.target.checked);
              setInAppSet(true);
            }}
            aria-describedby={inAppHintId}
            className="size-5 accent-brand"
          />
          Players RSVP in the app too
        </label>
        <p id={inAppHintId} className="text-small text-text-muted">
          {hasRsvps
            ? "People have RSVP'd here, so RSVPs in the app stay on."
            : "Off by default with an invite link, so players have one guest list. Tick it to take RSVPs, a waitlist and RSVP emails here as well. Ticketed events always take RSVPs here."}
        </p>
      </div>
      <div hidden={themeWeek}>
        {/* Keyed by the saved values, so a failed save shows what was sent. */}
        <AudienceFields
          key={JSON.stringify(state.reach)}
          choices={choices}
          reach={state.reach}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          name="announce"
          value="yes"
          defaultChecked={state.announce}
          className="size-5 accent-brand"
        />
        {announceLabel}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="btn self-start btn-primary"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
