import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConfirmItsYou } from "@/components/confirm-its-you";
import { PageLoading } from "@/components/page-loading";
import { db } from "@/db/client";
import { signedInDevices } from "@/db/queries/devices";
import { passkeysOf, PASSKEY_NAME_MAX } from "@/db/queries/passkeys";
import { profileOf } from "@/db/queries/profile";
import { currentLeague } from "@/db/queries/seasons";
import { isFreshSession } from "@/lib/auth/config";
import { currentSession, requireSelf } from "@/lib/auth/permission";
import { demoStatus } from "@/lib/demo/guard";
import {
  removePasskeyAction,
  renamePasskeyAction,
  signOutDeviceAction,
  signOutOtherDevicesAction,
} from "./actions";
import { AddPasskey } from "./add-passkey";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Passkeys and devices" };

const PAGE = "/app/profile/security";

export default function SecurityPage(
  props: PageProps<"/app/profile/security">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Security {...props} />
      </Suspense>
    </main>
  );
}

const DONE: Record<string, string> = {
  added: "Passkey added. Next time, sign in with it.",
  renamed: "Passkey renamed.",
  removed: "Passkey removed.",
  device: "That device is signed out.",
  others: "Every other device is signed out.",
};

const ERRORS: Record<string, string> = {
  stale: "Confirm it's you first. Nothing was changed.",
  demo: "Signing out other devices is turned off in the demo.",
  device: "That device was already signed out.",
  passkey: "We couldn't find that passkey. Nothing was changed.",
};

async function Security({ searchParams }: PageProps<"/app/profile/security">) {
  const subject = await requireSelf("profile.edit", PAGE);
  const session = await currentSession();
  if (!session) notFound();
  const now = new Date();
  const [query, me, passkeys, devices, league] = await Promise.all([
    searchParams,
    profileOf(db, subject.userId),
    passkeysOf(db, subject.userId),
    signedInDevices(db, subject.userId, session.id, now),
    currentLeague(db),
  ]);
  if (!me) notFound();
  const demo = demoStatus(process.env).on;
  const fresh = isFreshSession(session.signedInAt, now);
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: league?.timeZone ?? "America/New_York",
  });
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  // In the demo every visitor shares the personas, so only this browser shows.
  const shown = demo ? devices.filter((d) => d.current) : devices;
  const others = shown.filter((d) => !d.current);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/profile" className="underline">
          Your profile
        </Link>
        <h1 className="text-h1">Passkeys and devices</h1>
        <p className="text-text-muted">
          How you sign in, and where you&apos;re signed in.
        </p>
      </header>
      {done && (
        <p role="status" className="rounded-lg border border-success p-3">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      <section aria-labelledby="passkeys" className="flex flex-col gap-3">
        <h2 id="passkeys" className="text-h2">
          Passkeys
        </h2>
        <p>
          Sign in with Face ID, Touch ID or your device PIN instead of waiting
          for an email. A passkey stays on your device (or syncs through your
          phone&apos;s password manager), so there is nothing to type or leak.
        </p>
        {passkeys.length === 0 ? (
          <p className="text-text-muted">
            You haven&apos;t added a passkey yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {passkeys.map((key) => (
              <li
                key={key.id}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
              >
                <p className="font-medium">{key.name || "Passkey"}</p>
                <p className="text-small text-text-muted">
                  {key.synced ? "Synced across your devices" : "On one device"}
                  {key.createdAt && <> · added {when.format(key.createdAt)}</>}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <form
                    action={renamePasskeyAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="passkey" value={key.id} />
                    <label className="flex flex-col gap-1 text-small">
                      <span>
                        Name
                        <span className="sr-only">
                          {" "}
                          of {key.name || "this passkey"}
                        </span>
                      </span>
                      <input
                        name="name"
                        defaultValue={key.name ?? ""}
                        maxLength={PASSKEY_NAME_MAX}
                        required
                        className="min-h-11 rounded-input border-2 border-border-strong bg-surface px-3 py-2 text-body text-text"
                      />
                    </label>
                    <SubmitButton className="btn btn-secondary">
                      Rename
                    </SubmitButton>
                  </form>
                  {fresh && (
                    <form action={removePasskeyAction}>
                      <input type="hidden" name="passkey" value={key.id} />
                      <SubmitButton className="btn border-danger bg-surface text-danger">
                        Remove
                        <span className="sr-only">
                          {" "}
                          {key.name || "this passkey"}
                        </span>
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {fresh ? (
          <AddPasskey />
        ) : (
          <ConfirmItsYou
            what={
              passkeys.length > 0 ? "add or remove a passkey" : "add a passkey"
            }
            email={me.email}
            next={PAGE}
            confirm={query.confirm}
            hasPasskey={passkeys.length > 0}
          />
        )}
      </section>

      <section aria-labelledby="devices" className="flex flex-col gap-3">
        <h2 id="devices" className="text-h2">
          Signed-in devices
        </h2>
        <p>
          You stay signed in on each device for 90 days after you last use it.
          Lost a phone, or used a friend&apos;s? Sign it out here.
        </p>
        <ul className="flex flex-col gap-3">
          {shown.map((device) => (
            <li
              key={device.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {device.name}
                  {device.current && (
                    <span className="ml-2 sticker">This device</span>
                  )}
                </p>
                <p className="text-small text-text-muted">
                  Signed in {when.format(device.signedInAt)} · last used{" "}
                  {when.format(device.lastUsedAt)}
                </p>
              </div>
              {!device.current && !demo && (
                <form action={signOutDeviceAction}>
                  <input type="hidden" name="session" value={device.id} />
                  <SubmitButton className="btn btn-secondary">
                    Sign out<span className="sr-only"> {device.name}</span>
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
        {demo ? (
          <p>In the demo, only this device is shown.</p>
        ) : others.length > 1 ? (
          <form action={signOutOtherDevicesAction}>
            <SubmitButton className="btn btn-secondary">
              Sign out all other devices
            </SubmitButton>
          </form>
        ) : null}
      </section>
    </>
  );
}
