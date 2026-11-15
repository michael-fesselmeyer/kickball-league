import { db } from "@/db/client";
import { shirtMakers } from "@/db/queries/shirt-makers";
import type { LeagueId } from "@/domain/ids";
import { MAX_DESIGN_LENGTH } from "@/domain/shirts/late";
import { displayHost } from "@/domain/friends/friend-form";
import { minimumLine } from "@/domain/shirts/makers";
import { SubmitButton } from "@/components/submit-button";
import { setOwnShirtsAction, setShirtDesignAction } from "./actions";

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  own: {
    ok: true,
    text: "Noted: the team wears its own shirts, so the league's shirt order skips it.",
  },
  own_after_order: {
    ok: true,
    text: "Noted. Some of your players' shirts are already in the league's order, and those stay in it. Ask the league to take any you don't want out. New players won't be added.",
  },
  league: {
    ok: true,
    text: "The team is back on the league's shirt order. Players without a shirt join the waiting list.",
  },
  design_saved: { ok: true, text: "Shirt description saved." },
  design_too_long: {
    ok: false,
    text: `Keep the description to ${MAX_DESIGN_LENGTH} characters.`,
  },
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

/**
 * A captain's shirt choices: the league's shirts or the team's own, a line
 * describing the shirt for the league history, and, for a team in its own
 * shirts, the directory of local makers.
 */
export async function ShirtSection({
  slug,
  leagueId,
  info,
  notice,
}: {
  slug: string;
  leagueId: LeagueId;
  info: { ownShirts: boolean; design: string | null };
  notice: string | undefined;
}) {
  const makers = info.ownShirts ? await shirtMakers(db, leagueId) : [];
  const message = notice ? NOTICES[notice] : undefined;
  return (
    <section
      id="shirts"
      aria-labelledby="shirts-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="shirts-heading" className="text-h2">
        Team shirts
      </h2>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.ok ? "border-border" : "border-danger"}`}
        >
          {message.text}
        </p>
      )}
      <p>
        {info.ownShirts
          ? "Your team wears its own shirts or jerseys. The league's shirt order skips it, and the roster says so."
          : "Your team is on the league's shirt order. Players who join after the order is placed wait on the league's late-joiner list."}
      </p>
      <form action={setOwnShirtsAction.bind(null, slug)}>
        <input type="hidden" name="own" value={info.ownShirts ? "no" : "yes"} />
        <SubmitButton className="btn min-h-11 btn-secondary">
          {info.ownShirts
            ? "Use the league's shirts instead"
            : "Our own shirts or jerseys"}
        </SubmitButton>
      </form>

      <form
        action={setShirtDesignAction.bind(null, slug)}
        className="flex flex-col gap-2"
      >
        <label htmlFor="shirt-design" className="font-bold">
          What the shirt looks like
        </label>
        <input
          id="shirt-design"
          name="design"
          maxLength={MAX_DESIGN_LENGTH}
          defaultValue={info.design ?? ""}
          autoComplete="off"
          aria-describedby="shirt-design-hint"
          className={field}
        />
        <p id="shirt-design-hint" className="text-small text-text-muted">
          Shown with your team on the league history page, for example
          &ldquo;Red jersey, white sleeves, number on the back&rdquo;.
        </p>
        <SubmitButton className="btn min-h-11 self-start btn-secondary">
          Save description
        </SubmitButton>
      </form>

      {info.ownShirts && (
        <div className="flex flex-col gap-2">
          <h3 className="text-h3">Local shirt makers</h3>
          {makers.length === 0 ? (
            <p className="text-text-muted">
              The league hasn&apos;t listed any makers yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {makers.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col rounded-lg border border-border p-3"
                >
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center self-start font-bold underline"
                  >
                    {m.name}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <p>{m.makes}</p>
                  <p className="text-small text-text-muted">
                    {minimumLine(m.minimumOrder)} · {displayHost(m.url)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-small text-text-muted">
            The league lists these makers for free and doesn&apos;t take
            anything from them. Check prices and minimums with the maker.
          </p>
        </div>
      )}
    </section>
  );
}
