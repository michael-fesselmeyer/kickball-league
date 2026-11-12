"use client";

import { lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import type { BoardProps } from "./board";

/**
 * The board is a desktop tool (information-architecture.md, "Admin:
 * schedule"), so its code is fetched only on a wide screen, and only on this
 * route. Narrower screens, and every screen until the code arrives, get the
 * server-rendered list passed as `children`; the move-or-swap form works on
 * all of them.
 */
const Board = lazy(() => import("./board").then((m) => ({ default: m.Board })));

const WIDE = "(min-width: 1024px)";

function subscribe(notify: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export function BoardLoader({
  children,
  ...props
}: BoardProps & { children: ReactNode }) {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  if (!wide) return children;
  return (
    <Suspense fallback={children}>
      <Board {...props} />
    </Suspense>
  );
}
