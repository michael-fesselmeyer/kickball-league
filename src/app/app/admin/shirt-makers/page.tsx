import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { shirtMakers } from "@/db/queries/shirt-makers";
import { displayHost } from "@/domain/friends/friend-form";
import {
  MAKER_FORM_ERRORS,
  type MakerFormError,
  MAX_MAKER_NAME,
  MAX_MAKES,
  minimumLine,
} from "@/domain/shirts/makers";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  createMakerAction,
  removeMakerAction,
  updateMakerAction,
} from "./actions";

export const metadata: Metadata = { title: "Shirt makers" };

const PAGE = "/app/admin/shirt-makers";

const SAVED: Record<string, string> = {
  created: "Maker added. Captains whose team wears its own shirts see it now.",
  updated: "Changes saved.",
  removed: "Maker removed from the directory.",
};

const ERRORS: Record<string, string> = {
  ...MAKER_FORM_ERRORS,
  name_taken: "A maker with that name is already in the directory.",
  not_found: "That maker is no longer in the directory.",
  confirm: "Tick the box to confirm the removal.",
};

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

export default function ShirtMakersPage(
  props: PageProps<"/app/admin/shirt-makers">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the makers…</PageLoading>}>
        <ShirtMakers {...props} />
      </Suspense>
    </main>
  );
}

function MakerFields({
  prefix,
  values,
}: {
  prefix: string;
  values: {
    name: string;
    url: string;
    makes: string;
    minimumOrder: string;
  };
}) {
  return (
    <>
      <label htmlFor={`${prefix}-name`} className="font-bold">
        Name
      </label>
      <input
        id={`${prefix}-name`}
        name="name"
        required
        maxLength={MAX_MAKER_NAME}
        autoComplete="off"
        defaultValue={values.name}
        className={control}
      />
      <label htmlFor={`${prefix}-url`} className="font-bold">
        Website
      </label>
      <input
        id={`${prefix}-url`}
        name="url"
        required
        inputMode="url"
        autoComplete="off"
        defaultValue={values.url}
        className={control}
      />
      <label htmlFor={`${prefix}-makes`} className="font-bold">
        What they make
      </label>
      <input
        id={`${prefix}-makes`}
        name="makes"
        required
        maxLength={MAX_MAKES}
        autoComplete="off"
        defaultValue={values.makes}
        className={control}
      />
      <label htmlFor={`${prefix}-min`} className="font-bold">
        Minimum order (pieces, optional)
      </label>
      <input
        id={`${prefix}-min`}
        name="minimumOrder"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={values.minimumOrder}
        className={control}
      />
    </>
  );
}

async function ShirtMakers({
  searchParams,
}: PageProps<"/app/admin/shirt-makers">) {
  await requirePermission("shirts.manage", { next: PAGE });
  const query = await searchParams;
  const league = await activeLeague();
  const makers = league ? await shirtMakers(db, league.id) : [];
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : null;
  const error =
    typeof query.error === "string"
      ? (ERRORS[query.error as MakerFormError] ?? null)
      : null;
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Shirt makers</h1>
        <p className="text-text-muted">
          Local custom jersey and t-shirt makers. Captains whose team wears its
          own shirts see this list on their team page. Listings are free: the
          league takes nothing from a maker, and a link is only ever to the
          maker&apos;s own https website.
        </p>
      </header>
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      <section aria-labelledby="add" className="flex flex-col gap-2">
        <h2 id="add" className="text-h2">
          Add a maker
        </h2>
        <form action={createMakerAction} className="flex flex-col gap-2">
          <MakerFields
            prefix="new"
            values={{ name: "", url: "", makes: "", minimumOrder: "" }}
          />
          <SubmitButton className="btn btn-primary min-h-11 self-start">
            Add maker
          </SubmitButton>
        </form>
      </section>
      <section aria-labelledby="list" className="flex flex-col gap-3">
        <h2 id="list" className="text-h2">
          In the directory ({makers.length})
        </h2>
        {makers.length === 0 && (
          <p className="text-text-muted">No makers listed yet.</p>
        )}
        {makers.map((m) => (
          <details key={m.id} className="rounded-lg border border-border p-3">
            <summary className="flex min-h-11 cursor-pointer flex-col justify-center">
              <span className="font-bold">{m.name}</span>
              <span className="text-small text-text-muted">
                {m.makes} · {minimumLine(m.minimumOrder)} · {displayHost(m.url)}
              </span>
            </summary>
            <form
              action={updateMakerAction.bind(null, m.id)}
              className="mt-3 flex flex-col gap-2"
            >
              <MakerFields
                prefix={m.id}
                values={{
                  name: m.name,
                  url: m.url,
                  makes: m.makes,
                  minimumOrder: m.minimumOrder?.toString() ?? "",
                }}
              />
              <SubmitButton className="btn btn-secondary min-h-11 self-start">
                Save changes
              </SubmitButton>
            </form>
            <form
              action={removeMakerAction.bind(null, m.id)}
              className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3"
            >
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="confirm" value="yes" />
                Yes, remove {m.name}
              </label>
              <SubmitButton className="min-h-11 text-danger underline">
                Remove from the directory
              </SubmitButton>
            </form>
          </details>
        ))}
      </section>
    </>
  );
}
