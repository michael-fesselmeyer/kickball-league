"use client";

import { useEffect, useState } from "react";
import { type SavedGame, savedGame } from "@/lib/pwa/offline-cache";

/**
 * The game saved on this device, if any. It is read from the browser's
 * cache, so it works with no signal. A plain link, not next/link: the
 * service worker answers the full page load from the saved copy.
 */
export function SavedGameLink() {
  const [game, setGame] = useState<SavedGame | null | undefined>(undefined);
  useEffect(() => {
    void savedGame().then(setGame);
  }, []);

  if (game === undefined) return null;
  if (game === null)
    return (
      <p className="text-text-muted">
        Open the app&apos;s home screen once with a signal and your next game
        will be saved here.
      </p>
    );
  return (
    <p>
      Your next game is saved on this phone:{" "}
      <a href={game.path} className="font-bold text-brand underline">
        {game.label}
      </a>
    </p>
  );
}
