import { viewAs } from "@/app/demo/actions";
import { demoStatus } from "@/lib/demo/guard";
import { PERSONA_KEYS, PERSONAS } from "@/lib/demo/personas";

/**
 * Shown on every page of the demo deployment, and nowhere else: says the
 * league is invented and lets anyone view it as each role in one tap.
 */
export function DemoBanner() {
  const status = demoStatus(process.env);
  if (!status.on) {
    // Someone asked for demo mode and a safety check refused it: say why.
    if (process.env.DEMO_MODE === "true")
      console.warn(`[demo] Demo mode is off. ${status.reason}`);
    return null;
  }
  return (
    <aside
      aria-label="Demo"
      className="border-b-2 border-text bg-highlight text-on-highlight"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-2 md:flex-row md:items-center md:justify-between md:gap-4 md:px-6">
        <p id="demo-view-as" className="text-small">
          <strong className="font-bold">Demo league.</strong> Everyone here is
          made up, and it all resets nightly. Tap around as a:
        </p>
        <form
          action={viewAs}
          aria-labelledby="demo-view-as"
          className="grid grid-cols-4 gap-2 md:flex md:shrink-0"
        >
          {PERSONA_KEYS.map((key) => (
            <button
              key={key}
              type="submit"
              name="persona"
              value={key}
              className="btn min-h-11 px-2 text-small btn-secondary md:px-4"
            >
              {PERSONAS[key].label}
            </button>
          ))}
        </form>
      </div>
    </aside>
  );
}
