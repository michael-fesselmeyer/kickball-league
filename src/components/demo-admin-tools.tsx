"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { demoTools, resetDemo } from "@/app/demo/actions";

/**
 * The demo banner's admin row: the demo's mail and, in the local demo, a
 * reset (docs/demo.md). Asked for once the page is in the browser, because
 * the banner is part of static public pages that never read who is
 * signed in. Shows nothing to anyone else.
 */
export function DemoAdminTools() {
  const [tools, setTools] = useState({ mail: false, reset: false });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let live = true;
    demoTools()
      .then((found) => {
        if (live) setTools(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!tools.mail) return null;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 pb-2 text-small md:px-6">
      <span className="font-bold">Admin:</span>
      <Link
        href="/app/admin/demo-mail"
        className="btn min-h-11 px-3 btn-secondary"
      >
        Demo mail
      </Link>
      {tools.reset &&
        (confirming ? (
          <form
            action={resetDemo}
            className="flex flex-wrap items-center gap-2"
          >
            <span id="demo-reset-warning">
              Start over? Everything changed in the demo is undone, and everyone
              is signed out.
            </span>
            <ResetButton />
            <button
              type="button"
              className="btn min-h-11 px-3 btn-secondary"
              onClick={() => setConfirming(false)}
            >
              Keep going
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn min-h-11 px-3 btn-secondary"
            onClick={() => setConfirming(true)}
          >
            Reset demo
          </button>
        ))}
    </div>
  );
}

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-describedby="demo-reset-warning"
      className="btn min-h-11 px-3 btn-primary"
    >
      {pending ? "Resetting… (about 20 seconds)" : "Yes, reset"}
    </button>
  );
}
