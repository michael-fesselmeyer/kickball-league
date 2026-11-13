/**
 * Friend codes keep a few people who sign up together on the same team.
 * One person starts a group and shares the code; friends enter it in their
 * quiz. Codes skip letters and digits that are easy to mix up (0/O, 1/I/L),
 * because people read them out loud and type them on phones.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** The most people one friend code can hold. */
export const FRIEND_GROUP_MAX = 4;

/** A new code from `random`, which returns a float in [0, 1). */
export function newFriendCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++)
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/**
 * The code someone typed, uppercased with spaces and dashes removed, or
 * null when it cannot be a code.
 */
export function normalizeFriendCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const c of code) if (!CODE_ALPHABET.includes(c)) return null;
  return code;
}

/** "ABC-DEF" for reading out loud. */
export function formatFriendCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
