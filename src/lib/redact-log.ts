const HIDDEN = "[hidden]";

/**
 * One line of server output with anything secret blanked out: the parameter
 * values the database driver prints after a failed query (for the session
 * lookup that is the session token), tokens in a URL's query string, bearer
 * tokens, and cookie headers. The rest of the line, an error and its stack,
 * is kept so a failure can still be read.
 *
 * The end-to-end servers' logs are public in CI, and no token may appear in
 * one, even a throwaway test value.
 */
export function redactLogLine(line: string): string {
  return line
    .replace(/^(\s*(?:\S+\s+)?params:)\s.*$/i, `$1 ${HIDDEN}`)
    .replace(
      /\b((?:session[_-]?)?token|secret|password|api[_-]?key|code)=[^\s&"'#]+/gi,
      `$1=${HIDDEN}`,
    )
    .replace(/\b(Bearer)\s+[\w.~+/=-]+/gi, `$1 ${HIDDEN}`)
    .replace(/\b((?:set-)?cookie:)\s.*$/i, `$1 ${HIDDEN}`);
}
