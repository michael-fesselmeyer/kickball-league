import type { Renderer } from "@/db/queries/outbox";
import type { DIGEST_KIND, MessageKind } from "@/domain/notifications/kinds";
import { err } from "@/domain/result";
import {
  topicLabel,
  unsubscribePagePath,
  unsubscribePostPath,
  unsubscribeToken,
} from "@/lib/unsubscribe";
import { actingAdminEmail } from "./acting-admin";
import { announcementEmail } from "./announcement";
import { awayShortEmail } from "./away-short";
import { booksNudgeEmail } from "./books-nudge";
import { booksReminderEmail } from "./books-reminder";
import { captainPollEmail } from "./captain-poll";
import { checklistReminderEmail } from "./checklist-reminder";
import type { Template } from "./define";
import { digestEmail } from "./digest";
import { emailBudgetEmail } from "./email-budget";
import { eventNoticeEmail } from "./event";
import { eventTicketEmail } from "./event-ticket";
import {
  gameDayChangeEmail,
  gameDayDecideEmail,
  gameDayWatchEmail,
} from "./game-day";
import { gearReminderEmail } from "./gear-reminder";
import { giveawayWinEmail } from "./giveaway";
import { instagramReconnectEmail } from "./instagram-reconnect";
import { interestGoAheadEmail } from "./interest-go-ahead";
import { instagramStorageFullEmail } from "./instagram-storage-full";
import type { RenderContext } from "./layout";
import { merchEmail } from "./merch";
import { newTeamEmail } from "./new-team";
import {
  guaranteeFailedEmail,
  guaranteeWarningEmail,
  rebateCreditEmail,
  referralCreditEmail,
  waitlistOfferEmail,
} from "./money";
import { paymentReminderEmail } from "./payment-reminder";
import { permitAlertEmail } from "./permit-alert";
import { incidentFiledEmail } from "./incident-filed";
import { lostFoundReplyEmail, lostFoundUpdateEmail } from "./lost-found";
import { photoReviewEmail } from "./photo-review";
import { privateEventEmail } from "./private-event";
import { rainAlertEmail } from "./rain-alert";
import { rainDecisionEmail } from "./rain-decision";
import { rainoutNoticeEmail } from "./rainout-notice";
import { rainoutRequestEmail } from "./rainout-request";
import { refereeNeededEmail } from "./referee-needed";
import { ruleChangeEmail } from "./rule-change";
import { gameRulingEmail } from "./game-ruling";
import { scoreConfirmationEmail } from "./score-confirmation";
import { scoreDisputeEmail } from "./score-dispute";
import { scoreReminderEmail } from "./score-reminder";
import { seasonCardEmail } from "./season-card";
import { shirtSizeEmail } from "./shirt-size";
import { subRequestEmail, subUpdateEmail } from "./sub-request";
import { surveyInviteEmail } from "./survey-invite";
import { winBackEmail } from "./win-back";
import { concernUpdateEmail } from "./concern-update";
import { suspensionEmail } from "./suspension";
import { teamRoleEmail } from "./team-role";
import { volunteerReminderEmail } from "./volunteer-reminder";

/**
 * Every email the outbox can send, by the template name stored on the
 * message row. Each kind of league message adds one, and must first say
 * whether it is urgent in MESSAGE_KINDS (src/domain/notifications/kinds.ts):
 * a name that table does not list is a type error here.
 */
const TEMPLATES: Readonly<Record<MessageKind | typeof DIGEST_KIND, Template>> =
  {
    acting_admin: actingAdminEmail,
    announcement: announcementEmail,
    away_short: awayShortEmail,
    books_nudge: booksNudgeEmail,
    books_reminder: booksReminderEmail,
    checklist_reminder: checklistReminderEmail,
    captain_handoff: teamRoleEmail,
    captain_poll: captainPollEmail,
    digest: digestEmail,
    email_budget: emailBudgetEmail,
    event_news: eventNoticeEmail,
    event_notice: eventNoticeEmail,
    event_ticket: eventTicketEmail,
    game_day_change: gameDayChangeEmail,
    game_day_decide: gameDayDecideEmail,
    game_day_watch: gameDayWatchEmail,
    gear_reminder: gearReminderEmail,
    giveaway_win: giveawayWinEmail,
    guarantee_failed: guaranteeFailedEmail,
    guarantee_warning: guaranteeWarningEmail,
    instagram_reconnect: instagramReconnectEmail,
    instagram_storage_full: instagramStorageFullEmail,
    interest_go_ahead: interestGoAheadEmail,
    merch_receipt: merchEmail,
    merch_update: merchEmail,
    new_team: newTeamEmail,
    payment_reminder: paymentReminderEmail,
    permit_alert: permitAlertEmail,
    incident_filed: incidentFiledEmail,
    lost_found_reply: lostFoundReplyEmail,
    lost_found_update: lostFoundUpdateEmail,
    photo_review: photoReviewEmail,
    private_event: privateEventEmail,
    rain_alert: rainAlertEmail,
    rain_decision: rainDecisionEmail,
    rainout_notice: rainoutNoticeEmail,
    rainout_request: rainoutRequestEmail,
    rebate_credit: rebateCreditEmail,
    referee_needed: refereeNeededEmail,
    referral_credit: referralCreditEmail,
    rule_change: ruleChangeEmail,
    game_ruling: gameRulingEmail,
    score_confirmation: scoreConfirmationEmail,
    score_dispute: scoreDisputeEmail,
    score_reminder: scoreReminderEmail,
    season_card: seasonCardEmail,
    shirt_size_reminder: shirtSizeEmail,
    sub_request: subRequestEmail,
    sub_update: subUpdateEmail,
    concern_update: concernUpdateEmail,
    suspension: suspensionEmail,
    survey_invite: surveyInviteEmail,
    team_role: teamRoleEmail,
    volunteer_reminder: volunteerReminderEmail,
    waitlist_offer: waitlistOfferEmail,
    win_back: winBackEmail,
  };

const isTemplateName = (name: string): name is keyof typeof TEMPLATES =>
  Object.hasOwn(TEMPLATES, name);

/** The outbox's renderer for this site. */
/**
 * The outbox's renderer. With the server's secret, each email whose topic
 * the person can turn off carries their one-click unsubscribe.
 */
export function rendererFor(
  context: RenderContext & { unsubscribeSecret?: string },
): Renderer {
  const { unsubscribeSecret, ...base } = context;
  const site = base.siteUrl.replace(/\/$/, "");
  return (name, payload, recipient) => {
    const template = isTemplateName(name) ? TEMPLATES[name] : undefined;
    if (!template) return err(`No email template named ${name}`);
    const token =
      unsubscribeSecret && recipient
        ? unsubscribeToken(unsubscribeSecret, recipient.userId, recipient.topic)
        : null;
    return template(
      payload,
      token && recipient
        ? {
            ...base,
            unsubscribe: {
              pageUrl: `${site}${unsubscribePagePath(token)}`,
              oneClickUrl: `${site}${unsubscribePostPath(token)}`,
              topicLabel: topicLabel(recipient.topic),
            },
          }
        : base,
    );
  };
}
