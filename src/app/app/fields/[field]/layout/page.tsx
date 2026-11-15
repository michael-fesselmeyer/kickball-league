import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { fieldLayoutPage, onSetupShift } from "@/db/queries/field-layouts";
import { can } from "@/domain/authz/permissions";
import { type FieldId, parseId, type UserId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";

export const metadata: Metadata = {
  title: "Field layout",
  robots: { index: false },
};

/**
 * Where the permitted area ends and where each diamond and spectator area
 * goes on one field (#403), for admins and for members on a set-up shift.
 */
export default function FieldLayoutPage(
  props: PageProps<"/app/fields/[field]/layout">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading the layout…</PageLoading>}>
        <Layout {...props} />
      </Suspense>
    </main>
  );
}

async function Layout({ params }: PageProps<"/app/fields/[field]/layout">) {
  const { field: rawId } = await params;
  const subject = await requirePermission("public.view", {
    next: `/app/fields/${rawId}/layout`,
  });
  const fieldId = parseId<FieldId>(rawId);
  if (!fieldId) notFound();
  const leagueId = await activeLeagueId();
  if (!leagueId) notFound();
  const userId = parseId<UserId>(subject.userId);
  const allowed =
    can(subject, "season.manage") ||
    (userId !== null && (await onSetupShift(db, userId, leagueId, new Date())));
  if (!allowed) notFound();
  const layout = await fieldLayoutPage(db, leagueId, fieldId);
  if (!layout) notFound();
  const file = `/app/fields/${fieldId}/layout/file`;
  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">{layout.venueName}</p>
        <h1 className="text-h1">{layout.fieldName}</h1>
      </header>
      {layout.fileId === null ? (
        <p className="text-text-muted">
          {layout.noLayoutNeeded
            ? "An admin says this field needs no layout."
            : "No layout is on file for this field yet. Ask an admin."}
        </p>
      ) : layout.contentType === "application/pdf" ? (
        <a href={file} className="btn self-start btn-primary">
          Open the layout (PDF)
        </a>
      ) : (
        <figure className="flex flex-col gap-2">
          {/* A private, uncached file: next/image would cache it. Its size
              isn't stored, so a fixed-ratio box holds its space (#498). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file}
            alt={`Layout of ${layout.fieldName}: where the permitted area ends and where each diamond and spectator area goes`}
            className="aspect-[4/3] w-full rounded-lg border border-border bg-surface-2 object-contain"
          />
        </figure>
      )}
      {layout.note && <p>{layout.note}</p>}
      <Link href="/app" className="underline">
        Back to your home screen
      </Link>
    </>
  );
}
