import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { type FormRow, interestForms } from "@/db/queries/interest";
import { openedLeagues } from "@/db/queries/interest-league";
import { SPORTS } from "@/domain/league/new-league";
import { isCurrentOperator } from "@/lib/platform/site";
import {
  DEFAULT_PLAYERS_PER_TEAM,
  DEFAULT_TEAMS_NEEDED,
  FORMATS,
  MAX_OPTIONS,
  NIGHTS,
  optionLabel,
  progressLine,
  readiness,
} from "@/domain/interest/interest";
import { leagueHref } from "@/domain/league/paths";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  addOptionAction,
  closeAction,
  goAheadAction,
  openLeagueAction,
  openFormAction,
  removeAnswerAction,
  removeOptionAction,
  reopenAction,
  targetAction,
} from "./actions";
import { ERRORS, isErrorKey, noticeText } from "./words";

export const metadata: Metadata = { title: "Interest sign-ups" };

const input =
  "min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text";

export default function InterestAdminPage(
  props: PageProps<"/app/admin/interest">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Interest sign-ups</h1>
        <p className="text-text-muted">
          Ask whether there are enough players for a new night, park or format
          before you book a permit. Anyone can answer; no account needed.
        </p>
      </header>
      <Suspense fallback={<p className="min-h-svh">Loading forms…</p>}>
        <Forms {...props} />
      </Suspense>
    </main>
  );
}

function OptionFields({ index }: { index: number | "" }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="flex flex-col gap-1 text-small">
        Night
        <select name={`night${index}`} defaultValue="" className={input}>
          <option value="">Any</option>
          {Object.entries(NIGHTS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-small">
        Format
        <select name={`format${index}`} defaultValue="" className={input}>
          <option value="">Any</option>
          {Object.entries(FORMATS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-small">
        Park
        <input
          name={`park${index}`}
          maxLength={80}
          placeholder="Any"
          className={input}
        />
      </label>
    </div>
  );
}

function OpenForm() {
  return (
    <form
      action={openFormAction}
      className="flex flex-col gap-4 rounded-card border-2 border-border p-4"
    >
      <h2 className="text-h2">Open an interest form</h2>
      <label className="flex flex-col gap-1 font-medium">
        Title
        <input
          name="title"
          required
          maxLength={80}
          defaultValue="Where should we grow?"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        A line for players <span className="font-normal">(optional)</span>
        <textarea
          name="intro"
          maxLength={600}
          rows={2}
          className={`${input} min-h-20`}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-medium">
          Teams needed to run
          <input
            name="teamsNeeded"
            inputMode="numeric"
            defaultValue={DEFAULT_TEAMS_NEEDED}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Players per team
          <input
            name="playersPerTeam"
            inputMode="numeric"
            defaultValue={DEFAULT_PLAYERS_PER_TEAM}
            className={input}
          />
        </label>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium">
          Options (fill as many rows as you need, up to {MAX_OPTIONS})
        </legend>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-small text-text-muted">Option {i + 1}</span>
            <OptionFields index={i} />
          </div>
        ))}
      </fieldset>
      <SubmitButton className="btn self-start btn-primary">
        Open the form
      </SubmitButton>
    </form>
  );
}

/** What the operator sees to open a league from an option (ADR 0072). */
type Opening = {
  operator: boolean;
  sport: string;
  opened: Map<string, { name: string; slug: string }>;
};

function FormCard({
  form,
  link,
  opening,
}: {
  form: FormRow;
  link: string;
  opening: Opening;
}) {
  const open = form.status === "open";
  return (
    <section
      aria-labelledby={`form-${form.id}`}
      className="flex flex-col gap-4 rounded-card border-2 border-border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id={`form-${form.id}`} className="text-h2">
          {form.title}
        </h2>
        <p className="text-small text-text-muted">
          {open ? "Open" : "Closed"} · {form.answers}{" "}
          {form.answers === 1 ? "answer" : "answers"}
          {open && (
            <>
              {" · "}
              <Link href={link} className="underline">
                {link}
              </Link>
            </>
          )}
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {form.options.map((o) => {
          const r = readiness(o.counts, form);
          const label = optionLabel(o);
          return (
            <li
              key={o.id}
              className="flex flex-col gap-2 border-t border-border pt-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{label}</strong>
                {r.enough && (
                  <span className="rounded-full border border-success px-2 text-small font-bold">
                    Enough to run
                  </span>
                )}
                {o.goAheadAt && (
                  <span className="rounded-full border border-border px-2 text-small font-bold">
                    Going ahead
                  </span>
                )}
              </div>
              <p>
                {progressLine(r, form.teamsNeeded)} · {o.counts.yesAnswers} yes
                ({o.counts.yesPeople}{" "}
                {o.counts.yesPeople === 1 ? "player" : "players"} with friends)
              </p>
              <p className="text-small text-text-muted">
                {o.counts.unsureAnswers} not sure ({o.counts.unsurePeople}{" "}
                players)
                {r.closeWithMaybes
                  ? ` · would reach ${form.teamsNeeded} teams if they all joined`
                  : ""}
              </p>
              {open && !o.goAheadAt && (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
                    Going ahead with {label}
                  </summary>
                  <form
                    action={goAheadAction.bind(null, o.id)}
                    className="mt-2 flex flex-col gap-2"
                  >
                    <p className="text-small text-text-muted">
                      Emails everyone who answered Yes or Not sure for this
                      option, once. It is not urgent mail, so it waits out quiet
                      hours.
                    </p>
                    <label className="flex flex-col gap-1">
                      Add a line, such as when registration opens (optional)
                      <textarea
                        name="note"
                        maxLength={500}
                        rows={2}
                        className={`${input} min-h-20`}
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="confirm" value="yes" />
                      Yes, send it
                    </label>
                    <SubmitButton className="btn self-start btn-primary">
                      Go ahead and tell them
                    </SubmitButton>
                  </form>
                </details>
              )}
              <OpenLeague option={o} label={label} opening={opening} />
              {open &&
                !o.goAheadAt &&
                o.counts.yesAnswers + o.counts.unsureAnswers === 0 && (
                  <form action={removeOptionAction.bind(null, o.id)}>
                    <SubmitButton className="min-h-11 underline">
                      Remove {label}
                    </SubmitButton>
                  </form>
                )}
            </li>
          );
        })}
      </ul>
      {open && form.options.length < MAX_OPTIONS && (
        <form
          action={addOptionAction.bind(null, form.id)}
          className="flex flex-col gap-2 border-t border-border pt-3"
        >
          <h3 className="text-h3">Add an option</h3>
          <OptionFields index="" />
          <SubmitButton className="btn self-start">Add</SubmitButton>
        </form>
      )}
      <form
        action={targetAction.bind(null, form.id)}
        className="flex flex-col gap-2 border-t border-border pt-3"
      >
        <h3 className="text-h3">Target</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            Teams needed
            <input
              name="teamsNeeded"
              inputMode="numeric"
              defaultValue={form.teamsNeeded}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Players per team
            <input
              name="playersPerTeam"
              inputMode="numeric"
              defaultValue={form.playersPerTeam}
              className={input}
            />
          </label>
        </div>
        <SubmitButton className="btn self-start">Save target</SubmitButton>
      </form>
      <form
        action={removeAnswerAction.bind(null, form.id)}
        className="flex flex-col gap-2 border-t border-border pt-3"
      >
        <h3 className="text-h3">Delete someone&apos;s answer</h3>
        <label className="flex flex-col gap-1">
          Their email address
          <input
            type="email"
            name="email"
            autoComplete="off"
            className={input}
          />
        </label>
        <SubmitButton className="btn self-start">Delete answer</SubmitButton>
      </form>
      <form action={(open ? closeAction : reopenAction).bind(null, form.id)}>
        <SubmitButton className="btn">
          {open ? "Close the form" : "Open it again"}
        </SubmitButton>
      </form>
    </section>
  );
}

/**
 * The league opened from an option, or for the operator, the one step that
 * opens it: a new league with a draft season (ADR 0072).
 */
function OpenLeague({
  option,
  label,
  opening,
}: {
  option: { id: string };
  label: string;
  opening: Opening;
}) {
  const opened = opening.opened.get(option.id);
  if (opened)
    return (
      <p className="text-small">
        Opened as{" "}
        <Link href={`/l/${opened.slug}`} className="underline">
          {opened.name}
        </Link>
        , with a draft season.
      </p>
    );
  if (!opening.operator) return null;
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
        Open {label} as a new league
      </summary>
      <form
        action={openLeagueAction.bind(null, option.id)}
        className="mt-2 flex flex-col gap-2"
      >
        <p className="text-small text-text-muted">
          Starts a league named after this option, with this league&apos;s
          colors, time zone and minimum age, and a draft season on its night six
          weeks from now with the last season&apos;s fees. Nothing is public
          until its admins open registration.
        </p>
        <label className="flex flex-col gap-1">
          Sport
          <select name="sport" defaultValue={opening.sport} className={input}>
            {SPORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className="btn self-start btn-primary">
          Open the league
        </SubmitButton>
      </form>
    </details>
  );
}

async function Forms({ searchParams }: PageProps<"/app/admin/interest">) {
  const subject = await requirePermission("interest.manage", {
    next: "/app/admin/interest",
  });
  const query = await searchParams;
  await connection();
  const league = await activeLeague();
  const forms = league ? await interestForms(db, league.id) : [];
  const opening: Opening = {
    operator: isCurrentOperator(subject.userId),
    sport: league?.sport ?? "kickball",
    opened: await openedLeagues(
      db,
      forms.flatMap((f) => f.options.map((o) => o.id)),
    ),
  };
  const notice =
    typeof query.notice === "string" ? noticeText(query.notice) : undefined;
  const error =
    typeof query.error === "string" && isErrorKey(query.error)
      ? ERRORS[query.error]
      : undefined;
  const link = league ? leagueHref(league, "/interest") : "/interest";
  const open = forms.some((f) => f.status === "open");
  return (
    <>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {!open && <OpenForm />}
      {forms.map((f) => (
        <FormCard key={f.id} form={f} link={link} opening={opening} />
      ))}
    </>
  );
}
