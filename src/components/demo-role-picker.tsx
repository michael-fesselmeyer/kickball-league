"use client";

import { useEffect, useState } from "react";
import { demoPersona, viewAs } from "@/app/demo/actions";
import { SubmitButton } from "@/components/submit-button";
import { PERSONA_KEYS, PERSONAS, type PersonaKey } from "@/lib/demo/personas";

/**
 * The demo banner's role picker: one select and a Go button, so the banner
 * stays one short row on a phone. Works before the page's script loads;
 * once it has, it shows the role this browser is viewing as, asked from the
 * browser because the banner is part of static pages.
 */
export function DemoRolePicker() {
  const [persona, setPersona] = useState<PersonaKey | "">("");
  useEffect(() => {
    let live = true;
    demoPersona()
      .then((found) => {
        if (live && found) setPersona(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <form action={viewAs} className="flex shrink-0 items-center gap-2">
      <label htmlFor="demo-persona" className="text-small font-bold">
        Viewing as
      </label>
      <select
        id="demo-persona"
        name="persona"
        required
        value={persona}
        onChange={(event) => setPersona(event.target.value as PersonaKey)}
        className="min-h-11 rounded-input border-2 border-text bg-surface px-2 text-small font-bold text-text"
      >
        <option value="" disabled>
          Pick a role
        </option>
        {PERSONA_KEYS.map((key) => (
          <option key={key} value={key}>
            {PERSONAS[key].label}
          </option>
        ))}
      </select>
      <SubmitButton className="btn min-h-11 px-4 text-small btn-secondary">
        Go
      </SubmitButton>
    </form>
  );
}
