/**
 * A readable name for a signed-in device, from the browser's User-Agent
 * header, for the account page's device list ("iPhone · Safari"). It is a
 * label to help a player recognise their own devices, not a security check:
 * the header is whatever the browser sent.
 */

type Rule = readonly [RegExp, string];

/** Most specific first: iPadOS and Android both also mention other systems. */
const DEVICES: readonly Rule[] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b.*\bMobile\b/, "Android phone"],
  [/\bAndroid\b/, "Android tablet"],
  [/\bCrOS\b/, "Chromebook"],
  [/\bWindows\b/, "Windows PC"],
  [/\bMacintosh\b|\bMac OS X\b/, "Mac"],
  [/\bLinux\b/, "Linux computer"],
];

/** Chromium-based browsers name themselves before "Chrome", so they go first. */
const BROWSERS: readonly Rule[] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const match = (rules: readonly Rule[], text: string): string | null =>
  rules.find(([pattern]) => pattern.test(text))?.[1] ?? null;

export function deviceName(userAgent: string | null | undefined): string {
  const text = userAgent ?? "";
  const device = match(DEVICES, text);
  const browser = match(BROWSERS, text);
  if (device && browser) return `${device} · ${browser}`;
  return device ?? browser ?? "Unknown device";
}
