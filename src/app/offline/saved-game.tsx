"use client";

import { useEffect, useState } from "react";
import { type SavedGame, savedGame } from "@/lib/pwa/offline-cache";

/**
 * The game saved on this device, if any. It is read from the browser's
 * cache, so it works with no signal. A plain link, not next/link: the
 * service worker answers the full page load from the saved copy.
 */
export function SavedGameLink() {
  const [game, setGame] = useState<SavedGame | null>(null);
  useEffect(() => {
    void savedGame().then(setGame);
  }, []);

  // The hint is in the server-rendered page, so it paints with the first
  // frame; the link replaces it only when a game is saved.
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
      {game.permit && (
        <>
          {" "}
          and its{" "}
          <a href={game.permit} className="font-bold text-brand underline">
            park permit
          </a>
        </>
      )}
    </p>
  );
}
