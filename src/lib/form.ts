import { recordOf } from "@/domain/guards";

/** The named text fields of a submitted form; a missing or file field reads as "". */
export function formStrings<const Keys extends readonly string[]>(
  form: FormData,
  keys: Keys,
): Record<Keys[number], string> {
  return recordOf(keys, (key) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  });
}
