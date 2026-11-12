/**
 * A structural check of an iCalendar document against the parts of RFC 5545
 * that calendar apps reject feeds for: line endings and length, component
 * nesting, required properties, escaping, and a VTIMEZONE for every TZID.
 * Returns a list of problems; an empty list means the feed is valid.
 */

/** Joins folded lines back into logical content lines. */
export function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter((l) => l !== "");
}

const TEXT_PROPERTIES = new Set([
  "SUMMARY",
  "LOCATION",
  "DESCRIPTION",
  "X-WR-CALNAME",
  "X-WR-CALDESC",
]);

function textProblem(value: string): string | null {
  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string;
    if (c === "\\") {
      const next = value[i + 1];
      if (next === undefined || !"\\;,nN".includes(next)) return "a bad escape";
      i++;
    } else if (c === ";" || c === ",") return `an unescaped "${c}"`;
    else if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(c))
      return "a control character";
  }
  return null;
}

type Component = { name: string; props: string[]; children: Component[] };

export function problems(ics: string): string[] {
  const found: string[] = [];
  if (!ics.endsWith("\r\n")) found.push("The feed does not end with CRLF.");
  const physical = ics.split("\r\n");
  physical.forEach((line, i) => {
    if (/[\r\n]/.test(line)) found.push(`Line ${i + 1} has a bare CR or LF.`);
    if (new TextEncoder().encode(line).length > 75)
      found.push(`Line ${i + 1} is longer than 75 octets.`);
  });

  const root: Component = { name: "", props: [], children: [] };
  const stack: Component[] = [root];
  const tzids = new Set<string>();
  for (const line of unfold(ics)) {
    const match = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!match) {
      found.push(`Not a content line: ${line}`);
      continue;
    }
    const [, name = "", params = "", value = ""] = match;
    const top = stack[stack.length - 1] as Component;
    if (name === "BEGIN") {
      const child: Component = { name: value, props: [], children: [] };
      top.children.push(child);
      stack.push(child);
    } else if (name === "END") {
      if (top.name !== value || stack.length === 1)
        found.push(`END:${value} does not close ${top.name || "anything"}.`);
      else stack.pop();
    } else {
      top.props.push(name);
      const tzid = /;TZID=([^;:]+)/.exec(params);
      if (tzid) tzids.add(tzid[1] as string);
      if (TEXT_PROPERTIES.has(name)) {
        const problem = textProblem(value);
        if (problem) found.push(`${name} has ${problem}.`);
      }
    }
  }
  if (stack.length > 1)
    found.push(`${(stack[stack.length - 1] as Component).name} is not closed.`);

  const [calendar, ...extra] = root.children;
  if (!calendar || calendar.name !== "VCALENDAR" || extra.length > 0) {
    found.push("The feed is not exactly one VCALENDAR.");
    return found;
  }
  const once = (c: Component, prop: string) => {
    const n = c.props.filter((p) => p === prop).length;
    if (n !== 1) found.push(`${c.name} has ${n} ${prop}, not one.`);
  };
  once(calendar, "VERSION");
  once(calendar, "PRODID");

  const zones = new Set<string>();
  for (const child of calendar.children) {
    if (child.name === "VEVENT") {
      for (const p of ["UID", "DTSTAMP", "DTSTART"]) once(child, p);
    } else if (child.name === "VTIMEZONE") {
      once(child, "TZID");
      if (child.children.length === 0)
        found.push("A VTIMEZONE has no STANDARD or DAYLIGHT observance.");
      for (const o of child.children)
        for (const p of ["DTSTART", "TZOFFSETFROM", "TZOFFSETTO"]) once(o, p);
    }
  }
  for (const line of unfold(ics)) {
    const m = /^TZID:(.*)$/.exec(line);
    if (m) zones.add(m[1] as string);
  }
  for (const id of tzids)
    if (!zones.has(id)) found.push(`TZID ${id} has no VTIMEZONE.`);
  return found;
}
