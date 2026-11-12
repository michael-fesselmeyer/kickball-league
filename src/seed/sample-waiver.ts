import { hashWaiverBody } from "@/domain/waiver/waiver";

/**
 * Sample waiver text for the demo only. It is not a legal document: the
 * league supplies its real waiver, reviewed by its lawyer, before launch
 * (docs/open-questions.md, question 9). The real text never goes in the
 * public repository.
 */
export const SAMPLE_WAIVER_TITLE = "Sample release of liability (demo only)";

export const SAMPLE_WAIVER_BODY = `# Sample text: not a legal document

This is placeholder text so the demo can show how signing works. The league will replace it with its own waiver before anyone plays.

# Taking part

I am 18 or older and I choose to take part in league games, practices and events. I understand that kickball is a physical activity and that I could be hurt.

# What I agree to

- I will follow the league rules and the referees' calls.
- I will tell a league organizer if I am hurt during play.
- I agree that photos of league games may include me, and I can ask for any photo of me to be taken down.

# Signing

Typing my full name below works as my signature for this season.`;

export const SAMPLE_WAIVER_SHA256 = hashWaiverBody(SAMPLE_WAIVER_BODY);
