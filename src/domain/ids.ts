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
export type RefereeAssignmentId = Brand<string, "RefereeAssignmentId">;
export type PermitWindowId = Brand<string, "PermitWindowId">;
export type BlackoutId = Brand<string, "BlackoutId">;
export type TeamConstraintId = Brand<string, "TeamConstraintId">;
export type ScheduleVersionId = Brand<string, "ScheduleVersionId">;
export type GamePlacementId = Brand<string, "GamePlacementId">;
export type AuditLogId = Brand<string, "AuditLogId">;
export type WaiverId = Brand<string, "WaiverId">;
export type WaiverSignatureId = Brand<string, "WaiverSignatureId">;
export type InviteId = Brand<string, "InviteId">;
export type PurchaseId = Brand<string, "PurchaseId">;
export type PurchaseItemId = Brand<string, "PurchaseItemId">;
export type PaymentId = Brand<string, "PaymentId">;
export type WebhookEventId = Brand<string, "WebhookEventId">;

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
