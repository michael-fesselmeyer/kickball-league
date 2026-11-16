# Voice guide

Every screen speaks as the league: casual, warm and brief. This page is the working version of the voice paragraph in [design-system.md](design-system.md). It covers words only; layout lives in the design system.

## Principles

1. **Say what happened, then what to do.** An error names the problem and the fix in one or two short sentences. No apology, no "oops", no "something went wrong" without a next step.
2. **Humor stays on happy paths.** A joke is welcome in a confirmation, an empty state or a welcome. Never in an error, a payment, a refund, a safety notice or anything legal (waivers, code of conduct, discipline). Nothing implies drinking is expected: "a drink (or a seltzer)" is the tone.
3. **Name the exact action.** A button says what it does ("Publish schedule"), and the confirmation says it happened ("Schedule published"). Avoid "Submit", "OK" and "Confirm" on their own.
4. **Use players' words.** "Alerts" or "notifications", not "push". "Spot" or "roster", not "slot" or "registration record". "Season", "game day", "ref", "captain", "free agent". Never show an id, an enum name or a status code.
5. **Use contractions.** "isn't", "couldn't", "you're". They read as a person talking. Keep "cannot" and "does not" out of messages.
6. **Say what will appear and how to add the first one** in an empty state.
7. **Say it the same way every time.** The table below fixes the words for things that were worded three ways.

## One word for one thing

| Say | Not |
| --- | --- |
| "That poll no longer exists." | "That poll is gone." / "That poll is already gone." |
| "isn't open" | "is not open" |
| "The league hasn't set a price yet." | "The league has not set a price for this yet." |
| "Sign in" / "Sign out" | "Log in" / "Log out" |
| "Sign up" (verb), "sign-up" (noun) | "Signup" |
| "Alerts" (what players get on their phone) | "Push" |
| "Remove" for taking something off a list, "Delete" only when it can't come back | Using them interchangeably |

## Before and after

| Where | Before | After |
| --- | --- | --- |
| Vote error | "Nice try! Pick someone other than yourself." | "You can't vote for yourself. Pick someone else." |
| Join link error | "This link does not work. Ask your captain for a new one." | "This link isn't valid. Ask your captain for a new one." |
| Contact form | "We can't take messages just now." | "Messages aren't going through right now. Try again later." |
| Contact form | "Please leave out the links." | "Leave the links out and send it again." |
| Game checklist | "Only the team's captains tick." | "Only the team's captains can tick items." |
| Payment | "Stripe could not start the payment. Try again in a minute." | "Stripe couldn't start the payment. Try again in a minute." |
| Registration | "The league has not set a price for this yet." | "The league hasn't set a price yet." |
| Admin email subject | "Urgent email is waiting for tomorrow" | "Urgent emails are on hold until tomorrow" |

## Checklist for a new string

- Would a player who has never seen the admin screens understand every word?
- Does an error say what to do next?
- Does the button name the action, and does the confirmation say it's done?
- Is there a joke in an error, payment or legal text? Take it out.
- Does an empty state say what will show up here and how to add the first one?
