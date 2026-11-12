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
