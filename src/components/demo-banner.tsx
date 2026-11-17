// Only a build made with DEMO_MODE=true includes the real tools (next.config.ts).
import { DemoAdminTools, DemoRolePicker } from "@/components/demo-tools";
import { demoStatus } from "@/lib/demo/guard";

/**
 * Shown on every page of the demo deployment, and nowhere else: says the
 * league is invented and lets anyone view it as each role from one picker.
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
      className="border-b-2 border-text bg-highlight text-on-highlight print:hidden"
    >
      {/* Wraps the picker below the words on the narrowest screens. */}
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1.5 md:px-6">
        <p className="text-small">
          <strong className="font-bold">
            Demo<span className="hidden sm:inline"> league.</span>
          </strong>
          <span className="hidden sm:inline">
            {" "}
            Everyone here is made up, and it all resets nightly.
          </span>
        </p>
        <DemoRolePicker />
      </div>
      <DemoAdminTools />
    </aside>
  );
}
