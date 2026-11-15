import { hashWaiverBody, normalizeWaiverBody } from "@/domain/waiver/waiver";

/** A code of conduct is hashed and shown the way a waiver is. */
export const hashConductBody = hashWaiverBody;
export const normalizeConductBody = normalizeWaiverBody;

export type ConductDraftErrors = { title?: string; body?: string };

/** Checks a new version before it is published. */
export function checkConductDraft(
  title: string,
  body: string,
): ConductDraftErrors {
  const errors: ConductDraftErrors = {};
  if (title.trim() === "" || title.trim().length > 120)
    errors.title = "Give the code a title of up to 120 characters.";
  const text = normalizeConductBody(body);
  if (text.length < 100)
    errors.body = "The code needs its full text (at least 100 characters).";
  else if (text.length > 20_000)
    errors.body = "Keep it under 20,000 characters.";
  return errors;
}

/**
 * The sections a new league's code starts from, so an admin edits wording
 * instead of starting from a blank page. It is only a starting point in the
 * editor: nothing is stored until an admin publishes a version.
 */
export const DEFAULT_CONDUCT_TITLE = "Code of conduct";
export const DEFAULT_CONDUCT_BODY = `# Play
- Play fair and keep it friendly. Cheer for good plays, both teams' included.
- Respect the ref's call. Questions go through your captain, after the play.
- No hard slides into bases and no throwing at a player's head.

# Sharing the park
- The park is public. Share the space with everyone who uses it, on and off the field.
- Stop play when someone walks onto the field, and pass the ball back kindly.
- Keep to the times on the league's permit.

# Alcohol, glass and sound
- No alcohol at the park. Keep after-game drinks at the bar.
- No glass at the park.
- No amplified sound at the park. Keep speakers off, and wear headphones if you want music.

# Leave no trace
- Take your trash, and any you find, when you go.
- Leave the field and the benches the way you found them.

# Online
- Keep league chats and social posts kind. No harassment, and no posting photos of people who asked you not to.
- Raise problems with the league privately rather than in a group chat.`;

/** What a person sees beside the box they tick. */
export type ConductAcceptError = "conduct_not_accepted" | "conduct_changed";
