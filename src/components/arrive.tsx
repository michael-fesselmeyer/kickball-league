"use client";

import { type ReactNode, useSyncExternalStore, ViewTransition } from "react";

const noSubscription = () => () => {};

/**
 * Content that streams in after its loading state settles into place
 * instead of popping in (motion.css, `.arrive`). Put it directly inside the
 * <Suspense> boundary.
 *
 * Only after a client navigation: while the page first loads, React's
 * streaming script would otherwise run the same animation over the first
 * paint, and wait on fonts and images before showing the content. The
 * server snapshot says "not yet", so the first load renders with no
 * animation; every later navigation in the open tab gets it.
 */
export function Arrive({ children }: { children: ReactNode }) {
  const navigated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <ViewTransition enter={navigated ? "arrive" : "none"} default="none">
      {children}
    </ViewTransition>
  );
}
