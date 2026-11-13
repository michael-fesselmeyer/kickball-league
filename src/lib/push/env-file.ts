/**
 * Adds a VAPID key pair to the text of an env file (`npm run push:keys`
 * writes .env.local with it). Returns null when the file already has a
 * key, so a working pair is never replaced by accident: replacing it
 * silently breaks every device that subscribed with the old one.
 */
export function withVapidKeys(
  content: string,
  keys: { publicKey: string; privateKey: string },
): string | null {
  const lines = content.split("\n");
  const isKey = (line: string) =>
    /^\s*VAPID_(PUBLIC|PRIVATE)_KEY\s*=/.test(line);
  const hasValue = (line: string) => line.split("=").slice(1).join("=").trim();
  if (lines.some((line) => isKey(line) && hasValue(line) !== "")) return null;
  const kept = lines.filter((line) => !isKey(line));
  while (kept.length > 0 && kept.at(-1) === "") kept.pop();
  return [
    ...kept,
    ...(kept.length > 0 ? [""] : []),
    "# Web push (npm run push:keys). Keep the private key secret.",
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    "",
  ].join("\n");
}
