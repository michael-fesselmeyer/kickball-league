# ADR 0017: An AI recap draft, checked, with spend reserved before each call

- Status: accepted
- Date: 2026-11-13

## Context

Admins already get a weekly recap drafted from templates ([architecture.md](../architecture.md), section 16; roadmap item 10). It is accurate but reads much the same every week. Roadmap item 20 adds an AI-written draft that tells the week's story in the league's voice. The feature has to be optional (most installs run without an API key), cost money only when an admin asks for it, never pass a monthly cap, and never put a wrong score in front of the league. "Ask the rulebook", the other half of item 20, waits until the league agrees to publish its rulebook text.

## Decision

**The model gets facts, not prose.** The recap screen already works out each game day's results, power rankings with movement, streaks, new league records and next week's game of the week. The AI draft is written from the same numbers, as JSON inside `<facts>` tags in the user message (`src/domain/ai/recap.ts`). The system prompt never changes; it sets the league's voice (casual, no pressure to drink), forbids anything not in the facts and says team names are data, not instructions. The model has no tools and sees no other league data.

**The answer is checked before anyone sees it.** The model must answer in a JSON schema (`subject`, `body`). We then check it ourselves: both fit the announcement limits; every number pair or triple joined by dashes is one of the day's scores (either order) or a team's record through the day; and the only link is the standings page. A draft that fails is discarded, its cost still recorded, and the admin keeps the template draft with a message saying why.

**Nothing is sent automatically.** An accepted draft is saved per game day (`recap_draft`) and loads into the same editor as the template draft. The admin can switch between the two, edits, and sends through the ordinary announcement flow. Reopening the screen costs nothing.

**Spend is reserved before each call.** Every call gets an `ai_usage` row. Inside a transaction that locks the league row, we add the month's spend and the call's worst case (the most input we will send, 8,000 tokens, plus every output token allowed, 4,000, at the model's list price). If that passes the budget, the call is refused; otherwise the row is written as `pending` at the worst case. After the call, the row gets the real cost from the response's token usage: `accepted`, `rejected` (answered but failed our checks, still billed) or `failed` (no answer, nothing billed). Two admins at once queue on the lock, and a crashed request leaves its worst case counted, so the month's spend never passes the budget.

**The budget is the operator's.** Whoever hosts the site holds the API key and pays for it, so the budget sits on the league row next to the operator's feature switches (ADR 0009). The default is $5 a month, counted per calendar month in UTC. The operator console shows the month's spend and sets the budget; each change is audited (`operator.ai_budget`). The operator can also switch the feature off. Admins see the month's spend under the button, and once the next call would pass the budget, the button is replaced by a note saying AI drafts are back on the first of next month.

**Hidden without a key, configured from the environment.** Two optional server variables turn the feature on: `ANTHROPIC_API_KEY`, the AI provider's API key, and `AI_MODEL`, the model (default `claude-opus-5-5`). Like `DEMO_MODE` (ADR 0004) and `OPERATOR_USER_IDS` (ADR 0009), they are read straight from the server's environment rather than through the validated schema in `src/lib/env.ts`, and checked where they are read (`aiSettings` in `src/domain/ai/models.ts`): a key not in the provider's format, or a model with no price in that file, leaves the feature off instead of stopping the server, because a call whose cost cannot be counted must never run. The key stays in the server's environment; it is never stored, logged or sent to a browser. With no usable key the recap screen is exactly what it was, and a saved AI draft stays out of sight too. Requests use low effort: a recap needs little reasoning, and output tokens, reasoning included, are most of the cost.

**A small HTTP client behind a model interface.** Adding a package was not possible when this was built, and the feature needs one endpoint. `src/services/ai.ts` posts one message to the provider's HTTP API and validates the reply with Zod, about a hundred lines, behind one function type (`AiCall`: a request in; the JSON answer and token usage out). The draft flow only sees that type, so the provider's SDK or an AI gateway could replace the fetch client later without touching its callers. The client takes an injected `fetch` and the draft flow takes the model as a function, so tests never reach the network or need a key.

## Alternatives considered

- **Let the model write freely from the template draft's text.** Simpler prompt, but the model would be paraphrasing prose, and a changed number would be hard to spot.
- **Check the answer by asking the model to cite facts.** More tokens and still self-reported; matching numbers against our own facts is cheap and certain for the mistake that matters most, a wrong score.
- **Charge after the call and stop once the month is over budget.** Simplest, but one call could cross the cap, and two at once could cross it twice.
- **A budget in each league's admin settings.** Owners run the league, but the operator holds the key and the bill, and the operator console is where the other platform switches already live.
- **The provider's official SDK, or an AI gateway.** The better default once a dependency can be added; either would replace `src/services/ai.ts` behind the same `AiCall` type. Prompt caching does not apply here: the system prompt is below the minimum size worth caching.
- **Validate the two variables at startup with the rest.** Consistent with the other keys, but the feature is optional and off by default, like demo mode and the operator list, and a wrong model name should switch one feature off, not stop the site.

## Consequences

- A typical draft costs about 3 cents on Claude Opus 5.5 and well under a cent on Claude Haiku 5.5. The availability check uses the worst case, about 11 cents on Opus, so a $5 budget allows at least 44 drafts a month.
- Scores written in words ("seven to five"), team names and plays are not checked; the admin reads every draft before sending it.
- A refusal or a cut-off answer is billed and shows as "no usable draft"; the admin can try again or use the template.
- The rulebook feature can reuse `ai_usage`, the reservation and the budget when it is built.
