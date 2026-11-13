"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the check-in code current on the bar's screen: fetches the page
 * again just after the code turns over, and asks the device to keep the
 * screen on while the page is open, where the browser allows it.
 */
export function RefreshAt({ at }: { at: number }) {
  const router = useRouter();
  useEffect(() => {
    const wait = Math.max(1_000, at - Date.now() + 1_000);
    const timer = window.setTimeout(() => router.refresh(), wait);
    return () => window.clearTimeout(timer);
  }, [at, router]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        ?.request("screen")
        .then((l) => {
          lock = l;
        })
        .catch(() => {
          // Not allowed here (battery saver, an older browser): the code
          // still refreshes; the screen may just sleep.
        });
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);
  return null;
}
