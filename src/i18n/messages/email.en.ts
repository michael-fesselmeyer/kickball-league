/**
 * The words of the emails players, captains and refs get, and of the push
 * notifications made from them (ADR 0094). Part of the English catalog
 * (`en.email`). Values the league writes into a message when it is queued,
 * such as a game's teams, day and time, arrive as `{slots}`.
 *
 * Emails only league admins get stay in English, like the admin screens
 * (`ENGLISH_ONLY_TEMPLATES` in src/emails/templates.ts).
 */
export const emailEn = {
  layout: {
    because: "You got this email because {reason}.",
    settings: "Choose which emails you get and when",
    stopAbout: "Stop emails about {topic}",
    pushBecause: "Because {reason}.",
    fewer: "Fewer emails instead?",
    turnDown: {
      team: "Only my team",
      weekly: "Weekly digest instead",
      snooze: "Snooze for 2 weeks",
    },
  },
  /** Lowercase, as they follow "Stop emails about". */
  topics: {
    rainout: "rain-outs",
    schedule_change: "schedule changes",
    game_reminder: "game reminders",
    payment: "payments and registration",
    sub_request: "sub requests",
    announcement: "league news",
    score: "scores",
    events: "events",
    marketing: "league news and offers",
    new_team: "new-team requests",
    discipline: "suspensions",
    digest: "the digest",
    operations: "league operations",
    photos: "your photos",
    team_roles: "captain and co-captains",
    game_day_watch: "weather watches",
    lost_found: "lost and found",
    rules: "rules and schedule",
  },
  common: {
    seeGame: "See the game",
    seeTeam: "See your team",
    seeEvent: "See the event",
    seeOrders: "See your orders",
    seeCredit: "See your credit",
    seeOtherRequests: "See other requests",
    openApp: "Open the app",
    fromLeague: "From the league: {text}",
    cardRefund:
      "{returned}. A card refund usually shows up within 5 to 10 days.",
    youPaid: "You paid {paid}.",
    nextFee: "It comes off your next fee automatically when you pay.",
  },
  announcement: {
    action: "Open the league app",
    reasonTeam: "you play on {team} in {season}",
    reasonLeague: "you are registered for {season}",
  },
  awayShort: {
    subject: "{team} may be short the week of {week}",
    heading: "Short the week of {week}?",
    lead: "{player} will be away that week, so {available} of your players are available for {games}.",
    game: "{when} vs {opponent}",
    and: " and ",
    subsOpen:
      "Ask for a sub now and players who are free that night will hear about it.",
    subsClosed:
      "Sub requests aren't open for playoff games; check with the league.",
    askSub: "Ask for a sub",
    reason: "you captain {team} in {season}",
  },
  concern: {
    received:
      "{league} got your message. Only the league's admins read it, and one of them will answer.",
    followInApp: "You can follow it in the app.",
    answerByEmail: "If you left an address, the answer comes to this email.",
    replied: "{league} replied:",
    closed: "{league} closed your message. What was done:",
    receivedTitle: "We got your message",
    replyTitle: "A reply from the league",
    closedTitle: "Your message is closed",
    reason: "you sent the league a message",
  },
  digest: {
    updates: { $plural: { one: "1 update", other: "{n} updates" } },
    subject: "League news: {updates}",
    headingDaily: "Your league news today",
    headingWeekly: "Your league news this week",
    lead: {
      $plural: {
        one: "Here is the update we held back so your inbox stays calm.",
        other:
          "Here are the {n} updates we held back so your inbox stays calm.",
      },
    },
    reasonDaily: "you chose to get news that can wait in one daily email",
    reasonWeekly: "you chose to get news that can wait in one weekly email",
    reasonCap: {
      $plural: {
        one: "you get at most {n} league email a day that can wait, and these came after that",
        other:
          "you get at most {n} league emails a day that can wait, and these came after that",
      },
    },
    settings: "Change your daily limit, digest or quiet hours",
  },
  event: {
    rsvpOn: "RSVP on {site}: {url}",
    announcedSubject: "New event: {title}",
    updatedSubject: "Update: {title}",
    announcedHeading: "You're invited: {title}",
    updatedHeading: "{title} has changed",
    announcedLead: "{title} is on: {where}.",
    updatedLead: "The league changed the details of {title}. It's now {where}.",
    postedReason: "the league posted an event for you",
    spotSubject: "You're in: {title}",
    spotHeading: "A spot opened up for {title}",
    spotLead:
      "You were on the waitlist for {title} ({where}), and now you have a spot.",
    spotDrop:
      "Plans changed? Drop your spot on the event page so the next person on the list gets it.",
    waitlistReason: "you joined this event's waitlist",
    offSubject: "Called off: {title}",
    offHeading: "{title} is called off",
    offLead:
      "The league called off {title} ({where}). Sorry about that. Your RSVP is cleared and there's nothing you need to do.",
    otherEvents: "See other events",
    rsvpReason: "you RSVP'd to this event",
  },
  ticket: {
    receiptSubject: "Your ticket: {title}",
    receiptHeading: "You're going to {title}",
    receiptLead: "Your ticket for {title} ({where}) is confirmed.",
    code: "Your check-in code is {code}. Show it at the door.",
    seeTicket: "See your ticket",
    boughtReason: "you bought a ticket",
    refundedSubject: "Refunded: {title}",
    refundedHeading: "Your ticket for {title} is refunded",
    refundedLead:
      "The league refunded your ticket for {title} ({where}), so it no longer gets you in.",
    offeredSubject: "A spot opened: {title}",
    offeredHeading: "A spot opened up for {title}",
    offeredLead:
      "You were on the waitlist for {title} ({where}), and a spot is now held for you.",
    buyBy:
      "Buy your ticket by {expires}. After that it goes to the next person in line.",
    buy: "Buy your ticket. After that it goes to the next person in line.",
    buyAction: "Buy your ticket",
  },
  gameDay: {
    laterTime: "a later time",
    delayedSubject: "Starts late: {teams}, {day}",
    delayedHeading: "Your game now starts at {time}",
    delayedLead:
      "{teams} on {day} was due at {was} and now starts at {time}.{why}",
    offSubject: "Off: {teams}, {day}",
    offHeading: "Your game is off",
    offLead:
      "{teams} on {day} at {was} is off.{why} You'll hear its makeup time once the league reschedules it.",
    backSubject: "Back on: {teams}, {day}",
    backHeading: "Your game is back on",
    backLead: "{teams} on {day} is back on at {was}.{why}",
    playReason: "you play in {season}",
    watchSubject: "Watching the weather: decision by {time}, {day}",
    watchHeading: "We'll decide by {time}",
    watchLead:
      "The league is watching the weather for {teams} on {day} and will decide by {time} whether games are on.{why}",
    watchMore:
      "If your game starts late or is called off, you'll get another message.",
    watchReason: "you asked for weather watches before your games",
  },
  gear: {
    holding: "You have {kit}.",
    onItsWay:
      "{kit} is on its way to you: confirm it in the app when you have it.",
    with: "{name} has {kit} right now; get it from them, and confirm in the app when they hand it over.",
    atHome:
      '{kit} is at {place}; tap "I picked up {kit}" in the app when you have it.',
    subject: "Bring {kit} to {place} by {by} on {day}",
    heading: "{kit} for {teams}",
    bring:
      "Bring it to {place} by {by} on {day}, half an hour before {teams} kicks off.",
    missing:
      "If anything is missing from the kit, report it in the app so the league can restock it.",
    action: "Open your gear",
    reason: "you're bringing league gear to this game",
  },
  giveaway: {
    subject: "You won the {event} giveaway",
    heading: "You won!",
    lead: "Your name came up in the giveaway at {event}: {prize}.",
    leadFrom:
      "Your name came up in the giveaway at {event}: {prize}, from {donor}.",
    claim:
      "The giveaway's page says how to claim it. The draw was random, from everyone who checked in.",
    action: "See your prize",
    reason: "you entered the giveaway at {event}",
  },
  merch: {
    teamColors: "{description}, {team} colors",
    receiptSubject: "Your order: {description}",
    receiptHeading: "Thanks for your order",
    receiptLead: "Your order for {what} is in.",
    letYouKnow: "We'll let you know when it's ready.",
    reason: "you ordered from the league shop",
    readySubject: "Ready: {description}",
    readyHeading: "Your order is ready",
    readyLead:
      "Your {what} is ready. Look for it from the league at your next game.",
    refundedSubject: "Refunded: {description}",
    refundedHeading: "Your order was refunded",
    refundedLead: "The league refunded your order for {what}.",
  },
  money: {
    warningSubject: "{team} still owes {balance}: your card is charged {on}",
    warningHeading: "Heads up: {balance} left on {team}",
    warningLead:
      "Your team's {season} fee still has {balance} unpaid. As the team's guarantee, your {card} will be charged that amount on {on}.",
    warningLeadCharge:
      "Your team's {season} fee still has {balance} unpaid. As the team's guarantee, your {card} will be charged {charge} on {on}: the balance at the card price, which covers the card fee.",
    warningMore:
      "Anything your teammates pay before then comes off the charge. Collect the rest from them afterwards, or remove the card if you would rather pay another way.",
    whoPaid: "See who has paid",
    guaranteeReason: "you saved a card to guarantee {team}'s fee",
    failedSubject: "We couldn't charge your card for {team}",
    failedHeading: "Your card was declined",
    failedLead:
      "We tried to charge your saved card {balance} for the rest of {team}'s {season} fee, and the bank said no.",
    failedMore:
      "Your team is not confirmed until the fee is paid. Pay the balance from the team page, or save a different card.",
    payBalance: "Pay the balance",
    waitlistSubject:
      "A team spot opened in {season}. It's yours until {expires}",
    waitlistHeading: "You're up! A spot just opened",
    waitlistLead:
      "A team spot opened in {season} and you're next on the waitlist. We're holding it for you until {expires}.",
    waitlistMore:
      "Register your team before then to take it. After that, it goes to the next team in line.",
    registerTeam: "Register your team",
    waitlistReason: "you joined the {season} waitlist",
    referralSubject: "You earned {amount} in league credit",
    referralHeading: "Thanks for bringing a friend",
    referralLead:
      "Someone you invited just paid for {season}, so {amount} of league credit is in your account.",
    referralReason: "someone registered through your referral link",
    rebateSubject: "{amount} of league credit for the rained-out games",
    rebateHeading: "Some of your fee is coming back",
    rebateLead:
      "{team} lost {lost} of {count} games in {season} to weather that could not be made up. Your share of the rebate, {amount}, is now league credit.",
    rebateReason: "you paid toward {team}'s {season} fee",
  },
  newTeam: {
    approvedSubject: "{team} is in for {season}",
    approvedHeading: "Your team is approved",
    approvedLead:
      "The league said yes: {team} is set up for {season}, with you as captain.",
    approvedMore:
      "Next, share your team's invite link so your players can join, and sign the waiver. The team is confirmed once it has enough players and the fee is covered.",
    invite: "Invite your players",
    askedReason: "you asked to start {team}",
    declinedSubject: "About your request to start {team}",
    declinedHeading: "Your new-team request",
    declinedLead: "The league can't add {team} to {season}.",
    declinedMore: "You can still join a team by invite or as a free agent.",
    seeSeason: "See your season",
    leftSubject: "{player} is starting a new team",
    leftHeading: "{player} left {left}",
    leftLead:
      "The league approved {player}'s request to start {team} in {season}, so they are no longer on your roster.",
    leftMore:
      "If you need another player, invite one or ask the league for a free agent.",
    seeRoster: "See your roster",
    captainReason: "you captain {team}",
  },
  payment: {
    today: "today",
    tomorrow: "tomorrow",
    inDays: { $plural: { one: "in {n} day", other: "in {n} days" } },
    subject: "Your {season} fee is due {when}",
    heading: "Your spot needs paying {when}",
    lead: "The payment deadline for {season} is {deadline}. Pay before then to keep your spot.",
    waiverFirst:
      "Sign the season waiver first; the payment step comes right after.",
    byCard:
      "It takes a minute by card. If you already paid your captain in cash or Venmo, ask them to mark it in the app.",
    action: "Pay now",
    reason: "you registered for {season} and have not paid yet",
  },
  photo: {
    approvedSubject: "Your photo made the cut",
    approvedHeading: "Your photo is up",
    approvedLead:
      "Thanks for sharing! The league approved your photo, and it now shows on {where}. It may also turn up on the league's socials.",
    deleteAnytime: "You can delete it from your photos at any time.",
    seeIt: "See it on the site",
    rejectedSubject: "About the photo you uploaded",
    rejectedHeading: "The league didn't use your photo",
    rejectedLead:
      "Thanks for sending it in. The league won't be posting this one, so it has been deleted from the site.",
    keepThem:
      "Keep them coming: clear, well-lit photos of game days and events have the best chance.",
    yourPhotos: "Your photos",
    reason: "you uploaded a photo for the league",
  },
  privateEvent: {
    tournament: "tournament",
    league: "private league",
    reason: "you asked the league for a {what} for {organization}",
    receivedSubject: "We got your {what} request",
    receivedHeading: "Thanks, we have your request",
    receivedLead:
      "The league has your request for a {what} for {organization}. An admin will look at fields and dates and get back to you, usually within a week.",
    receivedMore: "You can see where it stands at any time.",
    seeRequest: "See your request",
    acceptedSubject: "{season} is on",
    acceptedHeading: "Your {what} is set up",
    acceptedLead:
      "The league set up {season} for {organization}. It is private: only your teams can join, and nothing about it shows on the league's public pages.",
    acceptedMore:
      "Share the invite link with each team's captain. Your page shows the teams as they join, the schedule once it is out, and the results.",
    organizerPage: "Open your organizer page",
    declinedSubject: "About your {what} request",
    declinedHeading: "Your request",
    declinedLead:
      "The league can't host a {what} for {organization} this time.",
    declinedMore: "You're welcome to ask again for other dates.",
    askAgain: "Ask again",
  },
  rainout: {
    movesSubject: "Rained out: {teams} moves to {makeup}",
    postponedSubject: "Rained out: {teams} is postponed",
    newTimeHeading: "Your game has a new time",
    postponedHeading: "Your game is postponed",
    lead: "{teams} ({was}) is rained out.",
    makeup: "The makeup is {makeup}. Tell your captain if you can't make it.",
    noMakeup:
      "It has no makeup time yet. The new time will be on the schedule as soon as the league sets it.",
    action: "See the schedule",
    reason: "you play in this game in {season}",
  },
  referee: {
    subject: "Ref needed: {teams}, {when}",
    heading: "Can you ref this game?",
    dropped: "{teams}, {when}, lost its ref.",
    none: "{teams}, {when}, has no ref yet.",
    first:
      'The first ref to tap "Take it" gets the game. If someone beat you to it, the page will say so.',
    action: "Take it",
    reason: "you ref in {season} and aren't playing or reffing at that time",
  },
  ruleChange: {
    subject: "Rule change from {on}: {summary}",
    heading: "The league's rules are changing",
    effective: "It takes effect on {on}.",
    sections: {
      $plural: {
        one: "Section changed: {sections}.",
        other: "Sections changed: {sections}.",
      },
    },
    read: "Read the new wording on the rules page, and ask your captain or the league if anything is unclear.",
    action: "Read the rules",
    reason: "you play in a season with the league",
  },
  scoreConfirm: {
    subject: "Confirm the score: {result}",
    heading: "Is this score right?",
    lead: "{reportedBy} reported {result} for {teams} ({when}).",
    more: "Confirm it, or dispute it if it's wrong. If nobody disputes it, it becomes final after 24 hours.",
    action: "Confirm or dispute",
    reason: "you captain one of the teams in this game",
  },
  scoreReminder: {
    subject: "Score needed: {teams}",
    heading: "What was the final score?",
    lead: "{teams} ({when}) has no score yet.",
    referee:
      "As the ref, enter it now so the standings update tonight. It takes a few seconds.",
    captain:
      "Your ref has not entered it. Either captain can, and the other team confirms.",
    action: "Enter the score",
    refereeReason: "you refereed this game",
    captainReason: "you captain one of the teams in this game",
  },
  seasonCard: {
    subject: "Your {season} season in kickball",
    heading: "Your season in kickball",
    lead: "{season} is in the books. Your card has your games, your team's runs and record, your awards and your best game.",
    private: "Only you can see it until you choose to share its link.",
    action: "See your season",
    reason: "you played in {season}",
  },
  shirt: {
    subject: "Your shirt size for {season}",
    heading: "What size shirt do you wear?",
    lead: "The league is ordering shirts for {season}, and we don't have your size yet.",
    pick: "Pick yours on your profile: {sizes}. It takes a few seconds.",
    action: "Pick my size",
    reason: "you're registered for {season}",
  },
  sub: {
    requestSubject: "{team} needs {spots}: {when}",
    requestHeading: "{team} needs a sub",
    requestLead: "{teams}, {when}. {team} is looking for {spots}.",
    fromCaptain: "From the captain: {note}",
    hold: "Tap \"I'm in\" to hold a spot. The captain confirms, and you'll hear back by email.",
    seeRequests: "See sub requests",
    freeAgentReason: "you are a free agent in {season} and free at that time",
    playerReason:
      "you play in {season} and your team is not playing at that time",
    claimedSubject: "{player} wants to sub: {when}",
    claimedHeading: "{player} can sub",
    claimedLead: "{player} is holding a spot for {teams}, {when}.",
    claimedMore:
      "Approve them so they know they're playing, or decline to free the spot.",
    approveOrDecline: "Approve or decline",
    captainReason: "you captain {team}, which asked for subs",
    withdrawnSubject: "{player} can't sub after all: {when}",
    withdrawnHeading: "A sub dropped out",
    withdrawnLead:
      "{player} can no longer play in {teams}, {when}. Their spot is open again.",
    seeYourRequest: "See your request",
    approvedSubject: "You're subbing for {team}: {when}",
    approvedHeading: "You're playing!",
    approvedLead:
      "The captain of {team} said yes. You're in for {teams}, {when}.",
    approvedMore:
      "Wear the team's color if you can. If your plans change, drop out from the sub page so they can find someone else.",
    seeDetails: "See the details",
    offeredReason: "you offered to sub for {team}",
    declinedSubject: "{team} is covered: {when}",
    declinedHeading: "Thanks for offering",
    declinedLead:
      "The captain of {team} has what they need for {teams}, {when}. Thanks for stepping up.",
    cancelledSubject: "{team} no longer needs subs: {when}",
    cancelledHeading: "Request taken down",
    cancelledLead:
      "{team} took down its sub request for {teams}, {when}, so you're not playing in it. Thanks for offering.",
  },
  survey: {
    subject: "How was {season}?",
    lead: "Five quick questions about the season, about two minutes. Your answers are anonymous: the league sees totals and comments, never who wrote them.",
    action: "Answer the survey",
    reason: "you played in {season}",
  },
  suspension: {
    subject: "You're suspended: {length}",
    heading: "You're suspended",
    banned:
      "After an incident report, {league} has banned you from playing, permanently.",
    suspended:
      "After an incident report, {league} has suspended you for {length} in {season}.",
    lastsGames:
      "It counts down as your team's games become final, and ends on its own once they are played.",
    lastsSeason: "It ends when the season ends.",
    lastsPermanent: "It lasts until the league lifts it.",
    meaning:
      "While you're suspended you can't RSVP that you're in for a game, claim a sub spot or be placed on a team from the free-agent pool. Your captain sees that you're suspended, not why.",
    appealTo:
      "To appeal, reply to this email or write to {email}, and say what you'd like the league to know.",
    appeal:
      "To appeal, reply to this email and say what you'd like the league to know.",
    reason: "the league suspended you after an incident report",
  },
  teamRole: {
    offeredSubject: "{captain} asked you to captain {team}",
    offeredHeading: "Captain {team}?",
    offeredLead:
      "{captain} would like you to take over as captain of {team} for {season}.",
    offeredMore:
      "Nothing changes until you say yes. As captain you run the roster, invites, payments and co-captains; they stay on as a co-captain.",
    answer: "Answer on your team page",
    playReason: "you play for {team}",
    acceptedSubject: "{player} is now captain of {team}",
    acceptedHeading: "Your team has a new captain",
    acceptedLead:
      "{player} accepted: they captain {team} for {season} from now on.",
    acceptedMore:
      "You stay on as a co-captain, with the team's lineups, sub requests and scores. The new captain can change that.",
    offeredReason: "you offered {player} the captaincy",
    declinedSubject: "{player} won't take over {team}",
    declinedHeading: "You're still the captain",
    declinedLead:
      "{player} said no to captaining {team}, so you stay captain for {season}.",
    declinedMore: "You can offer it to another teammate from your team page.",
    coSubject: "You're a co-captain of {team}",
    coHeading: "You're a co-captain",
    coLead:
      "You now help run {team} for {season}: set kicking orders, ask for subs, enter and confirm scores, and see who has paid.",
    coMore: "You can step down from your team page whenever you like.",
    playerSubject: "You're no longer a co-captain of {team}",
    playerHeading: "Back to playing",
    playerLead:
      "You're on {team} for {season} as a player now, without the co-captain's tools.",
  },
  volunteer: {
    subject: "Tomorrow: your {role} shift",
    heading: "Thanks for volunteering!",
    lead: "You're down for {role} at {occasion}: {when}.",
    leadAt: "You're down for {role} at {occasion}: {when}, {place}.",
    drop: "Can't make it after all? Drop the shift in the app so someone else can take it.",
    action: "See your shifts",
    reason: "you signed up for a volunteer shift",
  },
  winBack: {
    reason: "you played in the league before and {season} registration is open",
  },
} as const;
