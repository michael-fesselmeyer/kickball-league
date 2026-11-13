"use client";

import { useEffect } from "react";
import type { OfflineGame } from "@/domain/pwa/offline";
import { tellWorker } from "@/lib/pwa/offline-cache";

/**
 * Tells the service worker which game to keep for offline use: this
 * person's next one, or none. Renders nothing.
 */
export function OfflineSync({ game }: { game: OfflineGame | null }) {
  const path = game?.path ?? null;
  const label = game?.label ?? "";
  const permit = game?.permit ?? null;
  useEffect(() => {
    void tellWorker({ type: "next-game", path, label, permit });
  }, [path, label, permit]);
  return null;
}

/** Signing out also forgets the game saved on this device. */
export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => void tellWorker({ type: "forget" })}>
      <button type="submit" className="btn btn-secondary">
        Sign out
      </button>
    </form>
  );
}

/** Forgets the saved game when it mounts, as after an account is deleted. */
export function ForgetSavedGame() {
  useEffect(() => {
    void tellWorker({ type: "forget" });
  }, []);
  return null;
}
