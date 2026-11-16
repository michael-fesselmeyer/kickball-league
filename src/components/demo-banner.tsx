import { LazyDemoTool } from "@/components/demo-tools-lazy";
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
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-1.5 md:px-6">
        <p className="text-small">
          <strong className="font-bold">
            Demo<span className="hidden sm:inline"> league.</span>
          </strong>
          <span className="hidden sm:inline">
            {" "}
            Everyone here is made up, and it all resets nightly.
          </span>
        </p>
        <LazyDemoTool tool="rolePicker" />
      </div>
      <LazyDemoTool tool="adminTools" />
    </aside>
  );
}
