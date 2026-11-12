import type { Metadata } from "next";
import { SavedGameLink } from "./saved-game";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

/**
 * What the service worker shows when a page needs the network and there is
 * none. It is saved on the device with its styles, so it always loads.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-h1">No signal</h1>
      <p>
        This page needs a connection. It will load once you&apos;re back in
        range.
      </p>
      <SavedGameLink />
    </main>
  );
}
