/**
 * Branded ID types. At runtime every ID is a UUID string; at compile time a
 * LeagueId cannot be passed where a TeamId is expected, so mixing up two
 * identifiers is a type error instead of a wrong query.
 * See docs/architecture.md, section 1 ("TypeScript").
 */
declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type LeagueId = Brand<string, "LeagueId">;
export type UserId = Brand<string, "UserId">;
export type SeasonId = Brand<string, "SeasonId">;
export type TeamId = Brand<string, "TeamId">;
export type TeamSeasonId = Brand<string, "TeamSeasonId">;
export type RegistrationId = Brand<string, "RegistrationId">;
export type RosterMembershipId = Brand<string, "RosterMembershipId">;
export type VenueId = Brand<string, "VenueId">;
export type FieldId = Brand<string, "FieldId">;
export type SlotId = Brand<string, "SlotId">;
export type GameId = Brand<string, "GameId">;
export type ScoreReportId = Brand<string, "ScoreReportId">;
export type ScoreResponseId = Brand<string, "ScoreResponseId">;
export type GamePeriodId = Brand<string, "GamePeriodId">;
export type RefereeAssignmentId = Brand<string, "RefereeAssignmentId">;
export type GameRsvpId = Brand<string, "GameRsvpId">;
export type PermitWindowId = Brand<string, "PermitWindowId">;
export type BlackoutId = Brand<string, "BlackoutId">;
export type TeamConstraintId = Brand<string, "TeamConstraintId">;
export type ScheduleVersionId = Brand<string, "ScheduleVersionId">;
export type GamePlacementId = Brand<string, "GamePlacementId">;
export type AuditLogId = Brand<string, "AuditLogId">;
export type WaiverId = Brand<string, "WaiverId">;
export type WaiverSignatureId = Brand<string, "WaiverSignatureId">;
export type InviteId = Brand<string, "InviteId">;
export type FriendGroupId = Brand<string, "FriendGroupId">;
export type PurchaseId = Brand<string, "PurchaseId">;
export type PurchaseItemId = Brand<string, "PurchaseItemId">;
export type PaymentId = Brand<string, "PaymentId">;
export type WebhookEventId = Brand<string, "WebhookEventId">;
export type PromoCodeId = Brand<string, "PromoCodeId">;
export type RefundId = Brand<string, "RefundId">;
export type MessageId = Brand<string, "MessageId">;
export type AnnouncementId = Brand<string, "AnnouncementId">;
export type NotificationPreferenceId = Brand<
  string,
  "NotificationPreferenceId"
>;
export type PushSubscriptionId = Brand<string, "PushSubscriptionId">;
export type BracketId = Brand<string, "BracketId">;
export type BracketMatchId = Brand<string, "BracketMatchId">;
export type SubRequestId = Brand<string, "SubRequestId">;
export type SubClaimId = Brand<string, "SubClaimId">;
export type TeamFormationRequestId = Brand<string, "TeamFormationRequestId">;
export type EventId = Brand<string, "EventId">;
export type EventRsvpId = Brand<string, "EventRsvpId">;
export type EventTicketId = Brand<string, "EventTicketId">;
export type AwardPollId = Brand<string, "AwardPollId">;
export type AwardVoteId = Brand<string, "AwardVoteId">;
export type SponsorId = Brand<string, "SponsorId">;
export type SponsorMemberId = Brand<string, "SponsorMemberId">;
export type DealId = Brand<string, "DealId">;
export type CheckinId = Brand<string, "CheckinId">;
export type DealRedemptionId = Brand<string, "DealRedemptionId">;
export type TeamOfWeekId = Brand<string, "TeamOfWeekId">;
export type CreditEntryId = Brand<string, "CreditEntryId">;
export type SeasonRebateId = Brand<string, "SeasonRebateId">;
export type ReferralId = Brand<string, "ReferralId">;
export type SavedPaymentMethodId = Brand<string, "SavedPaymentMethodId">;
export type WaitlistEntryId = Brand<string, "WaitlistEntryId">;
export type SocialAccountId = Brand<string, "SocialAccountId">;
export type SocialPostId = Brand<string, "SocialPostId">;
export type SocialImageId = Brand<string, "SocialImageId">;
export type SportsmanshipRatingId = Brand<string, "SportsmanshipRatingId">;
export type IncidentId = Brand<string, "IncidentId">;
export type IncidentNoteId = Brand<string, "IncidentNoteId">;
export type SuspensionId = Brand<string, "SuspensionId">;
export type GameLineupId = Brand<string, "GameLineupId">;
export type GameLineupSpotId = Brand<string, "GameLineupSpotId">;
export type MemberPhotoId = Brand<string, "MemberPhotoId">;
export type BooksFileId = Brand<string, "BooksFileId">;
export type ExpenseId = Brand<string, "ExpenseId">;
export type InsuranceCertificateId = Brand<string, "InsuranceCertificateId">;
export type GiveawayId = Brand<string, "GiveawayId">;
export type GiveawayEntryId = Brand<string, "GiveawayEntryId">;
export type GiveawayWinnerId = Brand<string, "GiveawayWinnerId">;
export type SignupChallengeId = Brand<string, "SignupChallengeId">;
export type KeepOffId = Brand<string, "KeepOffId">;
export type MerchItemId = Brand<string, "MerchItemId">;
export type MerchImageId = Brand<string, "MerchImageId">;
export type MerchOrderId = Brand<string, "MerchOrderId">;
export type FriendLeagueId = Brand<string, "FriendLeagueId">;
export type FriendLogoId = Brand<string, "FriendLogoId">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads an ID from untrusted input, such as a form field. Returns null
 * unless it is a UUID, so a malformed value never reaches a query. This is
 * the one place a plain string becomes a branded ID; the caller still checks
 * the row exists and belongs to the league.
 */
export function parseId<Id extends Brand<string, string>>(
  value: unknown,
): Id | null {
  return typeof value === "string" && UUID.test(value) ? (value as Id) : null;
}
