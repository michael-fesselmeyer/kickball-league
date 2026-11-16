import { LOCALE_TAGS, type Locale } from "./locales";

/**
 * Message catalogs (ADR 0094). Each language's messages are a plain object
 * committed to the repo, shaped like the English one, and read on the
 * server. No library and nothing sent to the browser but the text a page
 * renders.
 *
 * - A message is a string with `{name}` slots, filled by `fill`.
 * - A count-dependent message is a `Plural`: its forms by CLDR plural
 *   category, chosen by `Intl.PluralRules` for the language.
 * - A language may leave a message out; `messagesFor` fills the gap with
 *   the English one, and a test lists every gap so none ships unnoticed.
 */

/** A message whose wording depends on a count: `{n}` is the count. */
export type Plural = {
  readonly $plural: Partial<Record<Intl.LDMLPluralRule, string>> & {
    readonly other: string;
  };
};

export type Message = string | Plural;

/** A tree of messages: the English catalog's shape. */
export type MessageTree = { readonly [key: string]: Message | MessageTree };

/** Another language's catalog: the same keys, every one optional. */
export type Translation<T> = {
  readonly [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends Plural
      ? Plural
      : Translation<T[K]>;
};

/** A catalog with every key present, as `messagesFor` returns it. */
export type Complete<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Plural
      ? Plural
      : Complete<T[K]>;
};

const isPlural = (value: unknown): value is Plural =>
  typeof value === "object" && value !== null && "$plural" in value;

const isTree = (value: unknown): value is MessageTree =>
  typeof value === "object" && value !== null && !isPlural(value);

/** `translation` over `base`: base fills every key the translation lacks. */
export function withFallback<T extends MessageTree>(
  base: T,
  translation: Translation<T> | undefined,
): Complete<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    const own = (translation as Record<string, unknown> | undefined)?.[key];
    out[key] = isTree(value)
      ? withFallback(value, isTree(own) ? own : undefined)
      : own !== undefined && typeof own === typeof value
        ? own
        : value;
  }
  return out as Complete<T>;
}

/** Every message key in a catalog, as dotted paths. */
export function keysOf(tree: MessageTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isTree(value) ? keysOf(value, path) : [path];
  });
}

/** The message at a dotted path, or undefined. */
export function messageAt(
  tree: MessageTree,
  path: string,
): Message | undefined {
  let node: Message | MessageTree | undefined = tree;
  for (const key of path.split(".")) {
    if (!isTree(node)) return undefined;
    const branch: MessageTree = node;
    node = branch[key];
  }
  return isTree(node) ? undefined : node;
}

/** The `{name}` slots a message uses, sorted. */
export function slotsOf(message: Message): string[] {
  const texts = isPlural(message) ? Object.values(message.$plural) : [message];
  const names = new Set<string>();
  for (const text of texts)
    for (const m of text.matchAll(/\{(\w+)\}/g)) if (m[1]) names.add(m[1]);
  return [...names].sort();
}

/**
 * A message with its `{name}` slots filled. A slot with no value stays as
 * written, so a gap shows up in testing instead of reading "undefined".
 */
export function fill(
  message: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return message.replace(/\{(\w+)\}/g, (slot, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : slot,
  );
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/**
 * A count-dependent message for `count`, in `locale`'s plural rules, with
 * `{n}` (the count, formatted for the language) and any other slots filled.
 */
export function plural(
  locale: Locale,
  message: Plural,
  count: number,
  values: Readonly<Record<string, string | number>> = {},
): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALE_TAGS[locale]);
    pluralRules.set(locale, rules);
  }
  const forms = message.$plural;
  const text = forms[rules.select(count)] ?? forms.other;
  return fill(text, {
    n: new Intl.NumberFormat(LOCALE_TAGS[locale]).format(count),
    ...values,
  });
}
