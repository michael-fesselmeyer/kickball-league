/**
 * The error's reference, when the server gave one, for the league to match
 * against its logs. Never the message: in production it can't hold details,
 * and a player can't act on one.
 */
export function ErrorCode({ error }: { error: unknown }) {
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined;
  if (!digest) return null;
  return (
    <p className="text-small text-text-muted">
      If you tell the league about this, mention code{" "}
      <code className="font-mono">{digest}</code>.
    </p>
  );
}
