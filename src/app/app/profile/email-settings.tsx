import { saveEmailSettingsAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

/** Which league emails the person gets, one checkbox per topic. */
export function EmailSettings({
  topics,
}: {
  topics: { topic: string; label: string; hint: string; enabled: boolean }[];
}) {
  return (
    <section
      id="notifications"
      aria-labelledby="notifications-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="notifications-heading" className="text-h2">
        Email settings
      </h2>
      <form action={saveEmailSettingsAction} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-text-muted">
            Choose which league emails you get. Sign-in links always come.
          </legend>
          {topics.map((t) => (
            <label key={t.topic} className="flex items-start gap-2">
              <input
                type="checkbox"
                name="topic"
                value={t.topic}
                defaultChecked={t.enabled}
                aria-describedby={`topic-${t.topic}-hint`}
                className="mt-1"
              />
              <span className="flex flex-col">
                {t.label}
                <span
                  id={`topic-${t.topic}-hint`}
                  className="text-small text-text-muted"
                >
                  {t.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <SubmitButton className="self-start rounded-full border border-text px-4 py-1">
          Save email settings
        </SubmitButton>
      </form>
    </section>
  );
}
