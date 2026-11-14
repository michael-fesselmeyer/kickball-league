import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  gamesOnLostPermits,
  insuranceCertificates,
  permitGroups,
  requestSheetInputs,
  storedBytes,
} from "@/db/queries/books";
import {
  FILE_MESSAGES,
  type FileProblem,
  storageLine,
} from "@/domain/books/files";
import { money } from "@/domain/books/ledger";
import { localDate } from "@/domain/books/ledger-csv";
import { daysUntil } from "@/domain/books/reminders";
import type { RequestProblem } from "@/domain/books/request-sheet";
import { fullWhen } from "@/domain/schedule/format";
import { requirePermission } from "@/lib/auth/permission";
import { CopySheet } from "../../copy-sheet";
import { FileInput } from "../../file-input";
import { booksSeason } from "../../load";
import { SeasonPicker } from "../../season-picker";
import {
  addInsuranceAction,
  removeInsuranceAction,
  savePermitDetailsAction,
} from "./actions";
import {
  choicesQuery,
  requestChoices,
  requestSheetFor,
  sheetText,
  WEEKDAYS,
} from "./request";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Permits and insurance" };

export default function PermitsPage(
  props: PageProps<"/app/books/[season]/permits">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Permits {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  amount: "Enter the cost in dollars, such as 450 or 1200.50.",
  date: "Enter dates as the date picker gives them.",
  bad_dates:
    "Check the dates: an application window closes after it opens, and a certificate expires after it starts.",
  no_insurer: "Enter the insurer's name.",
  unknown_permit: "That permit is no longer on this season.",
  unknown_certificate: "That certificate is already gone.",
  ...(FILE_MESSAGES satisfies Record<FileProblem, string>),
};

const NOTICES: Record<string, string> = {
  permit_saved: "Permit saved.",
  insurance_added: "Certificate added.",
  insurance_removed: "Certificate removed.",
};

const SHEET_PROBLEMS: Record<RequestProblem, string> = {
  no_teams:
    "There aren't enough teams in the season yet. Enter how many you expect.",
  no_dates:
    "No game days fall on that weekday between the season's start and end.",
  bad_time: "The last game has to end after the first one starts.",
  bad_length: "A game slot is 15 to 480 minutes long.",
  day_too_short: "The day is too short for one slot per game a team plays.",
};

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

async function Permits({
  params,
  searchParams,
}: PageProps<"/app/books/[season]/permits">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}/permits`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season, seasons } = await booksSeason(slug);
  const [groups, lostGames, inputs, certificates, used] = await Promise.all([
    permitGroups(db, season.id),
    gamesOnLostPermits(db, season.id),
    requestSheetInputs(db, league.id, season.id),
    insuranceCertificates(db, league.id),
    storedBytes(db, league.id),
  ]);
  const message = (
    table: Record<string, string>,
    key: string | string[] | undefined,
  ) => (typeof key === "string" ? table[key] : undefined);
  const error = message(ERRORS, query.error);
  const notice = message(NOTICES, query.notice);

  const tz = league.timeZone;
  const today = localDate(new Date(), tz);
  const day = (on: string | null) =>
    on
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${on}T12:00:00Z`))
      : "not set";
  const firstWindow = groups[0]?.windows[0];
  const choices = requestChoices(query, {
    teams: inputs.teams,
    weekday: new Date(
      `${firstWindow ? localDate(firstWindow.startsAt, tz) : season.startsOn}T12:00:00Z`,
    ).getUTCDay(),
  });
  const sheet = requestSheetFor(choices, season, inputs);
  const current = certificates[0];

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/books/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Books: {season.name}
        </Link>
        <h1 className="text-h1">Permits and insurance</h1>
        <p className="text-text-muted">
          NYC Parks has no public permit system to connect to, so permits are
          applied for on their site and tracked here. Owners get an email 30 and
          7 days before an application window opens, a permit renews or the
          insurance runs out.
        </p>
        <SeasonPicker
          seasons={seasons}
          current={season.slug}
          path={(s) => `/app/books/${s}/permits`}
        />
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
          className="flex flex-col gap-3 rounded-lg border-2 border-danger p-4"
        >
          <h2 id="lost" className="text-h2">
            {lostGames.length === 1
              ? "1 game is on a lost permit"
              : `${lostGames.length} games are on a lost permit`}
          </h2>
          <ul className="flex flex-col">
            {lostGames.map((g) => (
              <li key={g.id} className="border-b border-border py-2">
                {g.teamA} vs {g.teamB}
                <span className="block text-small text-text-muted">
                  {fullWhen(g.startsAt, tz)} · {g.fieldName}
                  {g.permitNumber ? ` · permit ${g.permitNumber}` : ""}
                </span>
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

      <section aria-labelledby="permits" className="flex flex-col gap-4">
        <h2 id="permits" className="text-h2">
          Permits
        </h2>
        {groups.length === 0 ? (
          <p className="text-text-muted">
            No permit windows yet. Admins add them on the{" "}
            <Link
              href={`/app/admin/seasons/${slug}/fields`}
              className="underline"
            >
              fields screen
            </Link>
            ; their cost and documents go here.
          </p>
        ) : (
          groups.map((g) => {
            const dates = g.windows.map((w) => localDate(w.startsAt, tz));
            const renewIn = g.renewsOn ? daysUntil(today, g.renewsOn) : null;
            return (
              <article
                key={g.key}
                aria-label={g.label}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <h3 className="text-h3">{g.label}</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-text-muted">Dates</dt>
                  <dd>
                    {g.windows.length} from {day(dates[0] ?? null)} to{" "}
                    {day(dates.at(-1) ?? null)}
                    {g.lost > 0 && (
                      <strong className="block text-danger">
                        {g.lost} marked lost
                      </strong>
                    )}
                  </dd>
                  <dt className="text-text-muted">Cost</dt>
                  <dd>
                    {g.costCents === null ? "not set" : money(g.costCents)}
                  </dd>
                  <dt className="text-text-muted">Applications</dt>
                  <dd>
                    {g.applicationOpensOn || g.applicationClosesOn
                      ? `${day(g.applicationOpensOn)} to ${day(g.applicationClosesOn)}`
                      : "not set"}
                  </dd>
                  <dt className="text-text-muted">Renews</dt>
                  <dd>
                    {day(g.renewsOn)}
                    {renewIn !== null && renewIn >= 0 && renewIn <= 30 && (
                      <strong className="ml-2">in {renewIn} days</strong>
                    )}
                  </dd>
                  <dt className="text-text-muted">Document</dt>
                  <dd>
                    {g.documentFileId ? (
                      <a
                        href={`/app/books/files/${g.documentFileId}`}
                        className="underline"
                      >
                        Open the permit
                        <span className="sr-only"> for {g.label}</span>
                      </a>
                    ) : (
                      "none yet"
                    )}
                  </dd>
                </dl>
                <details>
                  <summary className="btn cursor-pointer btn-secondary">
                    Edit<span className="sr-only"> {g.label}</span>
                  </summary>
                  <form
                    action={savePermitDetailsAction.bind(null, slug)}
                    className="mt-3 flex flex-col gap-3"
                  >
                    <input type="hidden" name="key" value={g.key} />
                    <label className="flex flex-col gap-1 self-start">
                      <span className="text-small">
                        Total cost in dollars (split across its{" "}
                        {g.windows.length} dates)
                      </span>
                      <input
                        name="cost"
                        inputMode="decimal"
                        autoComplete="off"
                        defaultValue={
                          g.costCents === null
                            ? ""
                            : (g.costCents / 100).toFixed(2)
                        }
                        className={`${input} w-36`}
                      />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-small">Applications open</span>
                        <input
                          type="date"
                          name="applicationOpensOn"
                          defaultValue={g.applicationOpensOn ?? ""}
                          className={input}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-small">Applications close</span>
                        <input
                          type="date"
                          name="applicationClosesOn"
                          defaultValue={g.applicationClosesOn ?? ""}
                          className={input}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-small">Renews on</span>
                        <input
                          type="date"
                          name="renewsOn"
                          defaultValue={g.renewsOn ?? ""}
                          className={input}
                        />
                      </label>
                    </div>
                    <FileInput
                      name="document"
                      label={
                        g.documentFileId
                          ? "Replace the permit document"
                          : "Permit document"
                      }
                      hint={`A photo or a PDF of 1 MB or less. The ref and captains see it on the game's page. Storage used: ${storageLine(used)}.`}
                    />
                    <SubmitButton className="btn self-start btn-primary">
                      Save permit
                    </SubmitButton>
                  </form>
                </details>
              </article>
            );
          })
        )}
      </section>

      <section aria-labelledby="request" className="flex flex-col gap-4">
        <h2 id="request" className="text-h2">
          What to request
        </h2>
        <p className="text-text-muted">
          The field time the league needs for {season.name}, from the number of
          teams, the game day and the slot length. Copy it into the NYC Parks
          application.
        </p>
        <form method="get" action={page} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-small">Teams</span>
              <input
                type="number"
                name="teams"
                min={0}
                max={200}
                defaultValue={choices.teams}
                className={`${input} w-24`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Game day</span>
              <select
                name="weekday"
                defaultValue={choices.weekday}
                className={input}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">First game</span>
              <input
                type="time"
                name="first"
                defaultValue={choices.firstGame}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Done by</span>
              <input
                type="time"
                name="last"
                defaultValue={choices.latestEnd}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Slot length (minutes)</span>
              <input
                type="number"
                name="slot"
                min={15}
                max={480}
                defaultValue={choices.slotMinutes}
                className={`${input} w-24`}
              />
            </label>
          </div>
          {inputs.fields.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-small">
                Fields to ask for, in order
              </legend>
              {inputs.fields.map((f) => (
                <label key={f.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    name="field"
                    value={f.id}
                    defaultChecked={choices.fieldIds.includes(f.id)}
                    className="size-5"
                  />
                  {f.venueName}, {f.name}
                </label>
              ))}
            </fieldset>
          )}
          <SubmitButton className="btn self-start btn-secondary">
            Work it out
          </SubmitButton>
        </form>
        {sheet.ok ? (
          <>
            <p>
              {sheet.value.gamesPerDay} games each game day need{" "}
              <strong>
                {sheet.value.fieldsNeeded}{" "}
                {sheet.value.fieldsNeeded === 1 ? "field" : "fields"}
              </strong>
              , {sheet.value.rows.length} field bookings and{" "}
              {sheet.value.totalFieldHours.toLocaleString("en-US")} field hours
              in all.
            </p>
            <CopySheet text={sheetText(sheet.value.rows)} />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">
                  Field bookings to request for {season.name}
                </caption>
                <thead>
                  <tr className="border-b-2 border-border-strong">
                    <th scope="col" className="py-2 pr-3">
                      Date
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Field
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Hours
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Games
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.value.rows.map((r) => (
                    <tr
                      key={`${r.date}/${r.field}`}
                      className="border-b border-border"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {day(r.date)}
                      </td>
                      <td className="py-2 pr-3">{r.field}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.start}–{r.end}
                      </td>
                      <td className="py-2 text-right">{r.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <a
              href={`/app/books/${slug}/permits/request.csv?${choicesQuery(choices)}`}
              className="btn self-start btn-secondary"
              download
            >
              Download the sheet (CSV)
            </a>
          </>
        ) : (
          <p role="status" className="rounded-lg border border-warning p-3">
            {SHEET_PROBLEMS[sheet.error]}
          </p>
        )}
      </section>

      <section aria-labelledby="insurance" className="flex flex-col gap-4">
        <h2 id="insurance" className="text-h2">
          Insurance certificate
        </h2>
        {current ? (
          <p>
            {current.insurer}
            {current.policyNumber ? `, policy ${current.policyNumber}` : ""}:
            covers {day(current.startsOn)} to {day(current.expiresOn)}.{" "}
            {daysUntil(today, current.expiresOn) < 0 ? (
              <strong className="text-danger">It has expired.</strong>
            ) : (
              <span>
                It expires in {daysUntil(today, current.expiresOn)} days.
              </span>
            )}
          </p>
        ) : (
          <p className="text-text-muted">
            No certificate yet. NYC Parks asks for one with each permit.
          </p>
        )}
        {certificates.length > 0 && (
          <ul className="flex flex-col">
            {certificates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
              >
                <span>
                  {c.insurer}
                  <span className="block text-small text-text-muted">
                    Until {day(c.expiresOn)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {c.documentFileId && (
                    <a
                      href={`/app/books/files/${c.documentFileId}`}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      Certificate
                      <span className="sr-only">
                        {" "}
                        from {c.insurer}, until {day(c.expiresOn)}
                      </span>
                    </a>
                  )}
                  <form action={removeInsuranceAction.bind(null, slug)}>
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton className="btn btn-secondary">
                      Remove
                      <span className="sr-only">
                        {" "}
                        {c.insurer}, until {day(c.expiresOn)}
                      </span>
                    </SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          action={addInsuranceAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <h3 className="text-h3">Add a certificate</h3>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-small">Insurer</span>
              <input
                name="insurer"
                required
                maxLength={120}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Policy number (optional)</span>
              <input name="policyNumber" maxLength={60} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Starts</span>
              <input type="date" name="startsOn" required className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Expires</span>
              <input type="date" name="expiresOn" required className={input} />
            </label>
          </div>
          <FileInput
            name="document"
            label="Certificate (optional)"
            hint="A photo or a PDF of 1 MB or less."
          />
          <SubmitButton className="btn self-start btn-primary">
            Add certificate
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
