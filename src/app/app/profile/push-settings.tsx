"use client";

import { useActionState, useEffect, useState } from "react";
import {
  browserPushGlobals,
  type DeviceState,
  deviceState,
  subscribeDevice,
  unsubscribeDevice,
} from "@/lib/pwa/push-client";
import {
  forgetPushDeviceAction,
  type PushSettingsState,
  savePushSettingsAction,
} from "./actions";

type Topic = { topic: string; label: string; hint: string; enabled: boolean };

const NOT_SUBSCRIBED: Record<"unsupported" | "blocked" | "failed", string> = {
  unsupported:
    "This browser can't show league notifications. On iPhone, add the app to your Home Screen first (iOS 16.4 or later) and open it from there.",
  blocked:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
  failed: "Your browser couldn't turn on notifications. Try again.",
};

/**
 * Push notifications, one checkbox per push topic. Saving with any topic
 * ticked asks the browser for permission and subscribes this device first.
 * Off until the person turns it on.
 */
export function PushSettings({
  publicKey,
  topics,
  devices,
}: {
  publicKey: string;
  topics: Topic[];
  devices: number;
}) {
  // Null until the browser has been asked, so the server render and the
  // first client render match.
  const [device, setDevice] = useState<DeviceState | null>(null);
  useEffect(() => {
    let live = true;
    void deviceState(browserPushGlobals()).then((s) => {
      if (live) setDevice(s);
    });
    return () => {
      live = false;
    };
  }, []);

  // The outcome of whichever button was pressed last.
  const [notice, setNotice] = useState<PushSettingsState>({ status: "idle" });
  const done = (result: PushSettingsState) => {
    setNotice(result);
    return result;
  };

  const [, save, saving] = useActionState<PushSettingsState, FormData>(
    async (previous, form) => {
      if (form.getAll("topic").length > 0 && device?.state !== "on") {
        const subscribed = await subscribeDevice(
          browserPushGlobals(),
          publicKey,
        );
        if (!subscribed.ok) {
          setDevice(await deviceState(browserPushGlobals()));
          return done({
            status: "error",
            message: NOT_SUBSCRIBED[subscribed.reason],
          });
        }
        form.set("subscription", subscribed.json);
        const result = await savePushSettingsAction(previous, form);
        if (result.status === "saved")
          setDevice({ state: "on", endpoint: subscribed.endpoint });
        return done(result);
      }
      return done(await savePushSettingsAction(previous, form));
    },
    { status: "idle" },
  );

  const [, turnOff, turningOff] = useActionState<PushSettingsState, FormData>(
    async (previous, form) => {
      const endpoint = await unsubscribeDevice(browserPushGlobals());
      setDevice({ state: "off" });
      if (!endpoint)
        return done({
          status: "saved",
          message: "Push is off on this device.",
        });
      form.set("endpoint", endpoint);
      return done(await forgetPushDeviceAction(previous, form));
    },
    { status: "idle" },
  );

  const cannot = device?.state === "unsupported" || device?.state === "blocked";

  return (
    <section
      id="push"
      aria-labelledby="push-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="push-heading" className="text-h2">
        Push notifications
      </h2>
      <p className="text-text-muted">
        Get a notification on your phone for the things you act on at the field.
        Email still comes too, as set above.
      </p>
      {/* Holds its line while the browser is asked, so nothing jumps. */}
      <p className="min-h-[3lh] text-small" aria-live="polite">
        {device === null
          ? ""
          : device.state === "on"
            ? "Push is on for this device."
            : device.state === "off"
              ? devices > 0
                ? `Push is on for ${devices === 1 ? "1 other device" : `${devices} devices`}, not this one. Tick a topic and save to add this one.`
                : "Push is off. Tick a topic and save, and your browser will ask to allow notifications."
              : NOT_SUBSCRIBED[device.state]}
      </p>
      <form action={save} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-3" disabled={cannot}>
          <legend className="sr-only">Push notification topics</legend>
          {topics.map((t) => (
            <label key={t.topic} className="flex items-start gap-2">
              <input
                type="checkbox"
                name="topic"
                value={t.topic}
                defaultChecked={t.enabled}
                aria-describedby={`push-${t.topic}-hint`}
                className="mt-1"
              />
              <span className="flex flex-col">
                {t.label}
                <span
                  id={`push-${t.topic}-hint`}
                  className="text-small text-text-muted"
                >
                  {t.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={cannot || saving}
          className="self-start rounded-full border border-text px-4 py-1 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save push settings"}
        </button>
      </form>
      {device?.state === "on" && (
        <form action={turnOff}>
          <button
            type="submit"
            disabled={turningOff}
            className="underline disabled:opacity-60"
          >
            Turn off push on this device
          </button>
        </form>
      )}
      {notice.status !== "idle" && (
        <p
          role={notice.status === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 ${notice.status === "error" ? "border-danger" : "border-success"}`}
        >
          {notice.message}
        </p>
      )}
    </section>
  );
}
