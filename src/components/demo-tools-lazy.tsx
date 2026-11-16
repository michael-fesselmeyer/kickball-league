"use client";

import { lazy, Suspense } from "react";

// The demo banner's tools, in a chunk of their own: every page's layout
// renders the banner, but only the demo deployment shows it, so no other
// site downloads this code (docs/design-system.md, Performance budgets). The
// server still renders them into the HTML, so the role picker works before
// any script loads.
const tools = () => import("./demo-tools");
const RolePicker = lazy(() =>
  tools().then((m) => ({ default: m.DemoRolePicker })),
);
const AdminTools = lazy(() =>
  tools().then((m) => ({ default: m.DemoAdminTools })),
);

/** One of the demo banner's tools, loaded only where the banner shows. */
export function LazyDemoTool({ tool }: { tool: "rolePicker" | "adminTools" }) {
  return (
    <Suspense fallback={null}>
      {tool === "rolePicker" ? <RolePicker /> : <AdminTools />}
    </Suspense>
  );
}
