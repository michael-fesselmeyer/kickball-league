/** "Tue, Sep 15" for a YYYY-MM-DD game day. */
export const dayLabel = (date: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

export const ERRORS: Record<string, string> = {
  no_published: "Publish a schedule before calling a rain-out.",
  no_games: "There are no slots on that date.",
};

export const NOTICES: Record<string, string> = {
  sent: "Sent to the owners. Each one gets a message with a link here to confirm.",
  admins_confirm:
    "Saved. Admins can now confirm rain-outs themselves, as owners can.",
  owners_confirm:
    "Saved. Only owners confirm rain-outs; admins send them to the owners.",
};
