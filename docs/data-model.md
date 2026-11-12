# Data model

Status: draft v1, 2026-11-11. Postgres on Neon, schema defined in Drizzle. Table and column names are final enough to build from; types are Postgres types.

## 1. Conventions

| Rule | Detail |
|---|---|
| Primary keys | `id uuid` default `gen_random_uuid()` |
| Audit fields on every table | `created_at timestamptz not null default now()`, `updated_at timestamptz not null`, `created_by uuid null` referencing `user` |
| Soft delete | `deleted_at timestamptz null` on teams, events, sponsors, posts and assets. Money, signatures, consent and audit rows are never deleted |
| Money | Integer cents in `*_cents` columns; currency is USD |
| Time | `timestamptz` in UTC. The league's time zone (`America/New_York`) lives on `league` and is applied when rendering and when generating slots |
| Enums | Postgres enums, named `<table>_<column>` |
| Flexible settings | `jsonb` with a Zod schema in code; nothing queried often lives in JSON |
| Names | Tables singular, snake_case |

The four tables Better Auth owns (`user`, `session`, `account`, `verification`) keep its names and shapes. Everything about a person that the league cares about is in `profile`.

A change history is kept two ways: `audit_log` records who changed what for admin-visible actions, and append-only tables (`waiver_signature`, `sms_consent_event`, `credit_entry`, `score_report`, `schedule_version`) are their own history.

## 2. Entity diagrams

One diagram per domain keeps them readable. Columns shown are the important ones; audit fields are omitted.

### 2.1 People, league, seasons, teams

```mermaid
erDiagram
  user ||--|| profile : has
  user ||--o{ registration : makes
  league ||--o{ season : runs
  league ||--o{ team : has
  league ||--o{ rule_set : defines
  league ||--o{ waiver : publishes
  season ||--o{ division : "may split into"
  season ||--o{ team_season : enters
  season ||--o{ registration : collects
  season }o--|| waiver : requires
  rule_set ||--o{ division : governs
  team ||--o{ team_season : "plays as"
  division |o--o{ team_season : groups
  team_season ||--o{ roster_membership : has
  registration ||--o| roster_membership : "placed as"
  team_season ||--o{ invite : issues
  registration ||--o| free_agent_profile : "answers quiz"
  friend_group ||--o{ registration : links
  waiver ||--o{ waiver_signature : "signed as"
  user ||--o{ waiver_signature : signs
  season ||--o{ team_formation_request : receives

  profile {
    uuid user_id PK
    text first_name
    text last_name
    text phone_e164
    timestamptz phone_verified_at
    enum gender "woman, man, nonbinary, self_described, undisclosed"
    enum lineup_gender "woman, man: which side of the fielding rule the player counts toward"
    enum shirt_size "xs, s, m, l, xl, xxl"
    date birth_date
    text emergency_contact_name
    text emergency_contact_phone
    enum global_role "player, admin, owner"
    text stripe_customer_id
    uuid avatar_asset_id FK
  }
  league {
    uuid id PK
    text name
    text slug UK
    text sport "kickball"
    text timezone
    jsonb branding "colors, logo asset ids"
    jsonb contact "email, phone, social links, WhatsApp link"
  }
  season {
    uuid id PK
    uuid league_id FK
    text name
    text slug
    enum status "draft, registration_open, registration_closed, in_progress, playoffs, completed"
    date starts_on
    date ends_on
    timestamptz registration_opens_at
    timestamptz registration_closes_at
    timestamptz payment_deadline_at
    enum fee_model "per_team, per_player"
    int team_fee_cents
    int player_fee_cents
    int free_agent_fee_cents
    timestamptz early_bird_ends_at
    int early_bird_discount_cents
    int max_teams
    int roster_min
    int roster_max
    int games_per_team_per_day "1 or 2"
    uuid waiver_id FK
    uuid default_rule_set_id FK
    jsonb fielding_rules "max fielders, max per gender, minimum to play, minimum own players"
    jsonb tiebreakers "ordered list"
    jsonb rebate_policy "threshold and method"
  }
  division {
    uuid id PK
    uuid season_id FK
    text name
    uuid rule_set_id FK
    int sort_order
  }
  rule_set {
    uuid id PK
    uuid league_id FK
    text name "for example Fun, Competitive"
    int innings
    int time_limit_minutes
    jsonb options "bunting, stealing, pitch to own team, golden ball"
  }
  team {
    uuid id PK
    uuid league_id FK
    text name
    text slug UK
    text color_hex
    uuid logo_asset_id FK
  }
  team_season {
    uuid id PK
    uuid team_id FK
    uuid season_id FK
    uuid division_id FK
    enum status "forming, pending_payment, confirmed, waitlisted, withdrawn"
    enum payment_mode "full, split"
    int share_cents
    int target_roster_size
    int seed
    text vibe "set by captain for matching"
  }
  registration {
    uuid id PK
    uuid season_id FK
    uuid user_id FK
    enum kind "team_member, free_agent"
    enum status "pending_waiver, pending_payment, active, waitlisted, cancelled, refunded"
    uuid friend_group_id FK
    uuid waiver_signature_id FK
    enum shirt_status "none, ordered, received"
  }
  roster_membership {
    uuid id PK
    uuid team_season_id FK
    uuid registration_id FK
    enum role "captain, co_captain, player"
    enum status "invited, active, removed"
    timestamptz started_at
    timestamptz ended_at
    bool shares_contact "visible to teammates"
  }
  invite {
    uuid id PK
    uuid team_season_id FK
    text token_hash UK
    text email
    enum status "open, accepted, revoked, expired"
    timestamptz expires_at
  }
  free_agent_profile {
    uuid registration_id PK
    jsonb answers
    int skill_score "1 to 5"
    int vibe_score "1 social to 5 competitive"
    bool would_captain
    text notes
  }
  friend_group {
    uuid id PK
    uuid season_id FK
    text code UK
  }
  waiver {
    uuid id PK
    uuid league_id FK
    int version
    text title
    text body_md
    text body_sha256
    timestamptz effective_at
  }
  waiver_signature {
    uuid id PK
    uuid waiver_id FK
    uuid user_id FK
    uuid season_id FK
    text signed_name
    timestamptz signed_at
    inet ip
    text user_agent
    text body_sha256 "hash of the exact text shown"
  }
  team_formation_request {
    uuid id PK
    uuid season_id FK
    uuid requested_by FK
    uuid current_team_season_id FK
    text proposed_name
    bool will_captain
    jsonb joining_user_ids
    enum status "pending, approved, declined, withdrawn"
    timestamptz captain_notified_at
    uuid decided_by FK
  }
```

Notes:
- `team` is the lasting identity (name, colors, logo, history). `team_season` is that team's entry in one season; rosters, payments and games hang off it.
- `registration` is one person's entry in one season and carries the waiver and payment state. `roster_membership` puts a registration on a team and keeps history when someone moves teams mid-season.
- `profile.lineup_gender` exists because the fielding rule counts two groups. How nonbinary players are counted is the league's call; the default is that the player chooses **(A)**.
- A captain is a `roster_membership` with `role = captain`. There is no captain column on `team_season`, so there is one source of truth.
- A team has one main captain, who makes final decisions and handles payment, and commonly one to three co-captains (`role = co_captain`, no limit in the schema). How much say co-captains have varies by team, so it is a per-team permission setting chosen by the main captain (Phase 1), not a schema rule. Paying for and withdrawing the team stay with the main captain.

### 2.2 Fields, schedule, games, scores

```mermaid
erDiagram
  venue ||--o{ field : contains
  field ||--o{ permit_window : "permitted for"
  season ||--o{ permit_window : uses
  season ||--o{ blackout : excludes
  season ||--o{ slot : offers
  field ||--o{ slot : hosts
  permit_window ||--o{ slot : "cut into"
  season ||--o{ schedule_version : has
  season ||--o{ game : contains
  schedule_version ||--o{ game_placement : places
  game ||--o{ game_placement : "placed by"
  slot ||--o{ game_placement : holds
  team_season ||--o{ game : plays
  team_season ||--o{ team_constraint : states
  game ||--o{ score_report : receives
  game ||--o{ score_confirmation : needs
  game ||--o{ game_period : "scored by"
  game ||--o{ game_rsvp : collects
  game ||--o{ sub_request : "may need"
  sub_request ||--o{ sub_claim : gets
  season ||--o{ bracket : "ends with"
  bracket ||--o{ bracket_match : has
  bracket_match |o--|| game : "played as"
  venue ||--o{ weather_snapshot : "forecast for"
  season ||--o{ rainout : records

  venue {
    uuid id PK
    text name
    text slug UK
    text address
    numeric lat
    numeric lng
    text neighborhood
  }
  field {
    uuid id PK
    uuid venue_id FK
    text name
    int sort_order
    text notes
  }
  permit_window {
    uuid id PK
    uuid field_id FK
    uuid season_id FK
    timestamptz starts_at
    timestamptz ends_at
    text permit_number
    uuid document_asset_id FK
    enum status "requested, confirmed, lost"
  }
  blackout {
    uuid id PK
    uuid season_id FK
    date on_date
    uuid field_id FK "null means all fields"
    text reason
  }
  slot {
    uuid id PK
    uuid season_id FK
    uuid field_id FK
    uuid permit_window_id FK
    timestamptz starts_at
    timestamptz ends_at
    int time_index "0 is the earliest slot of the day"
    enum kind "regular, makeup_reserve, playoff"
    enum status "open, cancelled"
  }
  schedule_version {
    uuid id PK
    uuid season_id FK
    int version_no
    uuid parent_version_id FK
    enum status "draft, published, superseded"
    enum origin "generated, manual_edit, rainout, playoffs"
    bigint seed
    jsonb input_snapshot "exact scheduler input"
    jsonb metrics "fairness metrics"
    jsonb violations "empty when valid"
    timestamptz published_at
    uuid published_by FK
    text note
  }
  game {
    uuid id PK
    uuid season_id FK
    uuid division_id FK
    int round_no
    uuid team_a_id FK "team_season"
    uuid team_b_id FK "team_season"
    enum kind "regular, playoff, exhibition"
    enum status "scheduled, in_progress, final, postponed, cancelled, forfeit"
    uuid slot_id FK "placement in the published version"
    int score_a
    int score_b
    int innings_played
    uuid forfeit_by FK "team_season"
    timestamptz finalized_at
  }
  game_placement {
    uuid id PK
    uuid schedule_version_id FK
    uuid game_id FK
    uuid slot_id FK "null means unplaced"
    bool locked "manual pin"
  }
  team_constraint {
    uuid id PK
    uuid team_season_id FK
    enum kind "unavailable, prefer, avoid"
    date on_date
    int time_index
    int weight
    text reason
  }
  score_report {
    uuid id PK
    uuid game_id FK
    uuid reported_by FK
    enum reporter_role "referee, captain, admin"
    int score_a
    int score_b
    int innings_played
    enum outcome "normal, forfeit_a, forfeit_b, called"
    text client_id UK "idempotency key from the device"
    timestamptz reported_at
  }
  score_confirmation {
    uuid id PK
    uuid game_id FK
    uuid team_season_id FK
    uuid user_id FK
    enum status "confirmed, disputed"
    text note
  }
  game_period {
    uuid id PK
    uuid game_id FK
    int period_no "inning number"
    enum half "top, bottom"
    int runs
  }
  game_rsvp {
    uuid id PK
    uuid game_id FK
    uuid user_id FK
    uuid team_season_id FK
    enum status "in, out, maybe"
  }
  sub_request {
    uuid id PK
    uuid game_id FK
    uuid team_season_id FK
    uuid requested_by FK
    int needed
    enum lineup_gender_needed "nullable"
    text note
    enum status "open, filled, closed"
    timestamptz closes_at
  }
  sub_claim {
    uuid id PK
    uuid sub_request_id FK
    uuid user_id FK
    enum status "offered, approved, passed, withdrawn"
  }
  bracket {
    uuid id PK
    uuid season_id FK
    uuid division_id FK
    enum format "single_elimination"
    int size
  }
  bracket_match {
    uuid id PK
    uuid bracket_id FK
    int round_no
    int position
    uuid game_id FK
    jsonb source_a "seed number or winner of a match"
    jsonb source_b
  }
  weather_snapshot {
    uuid id PK
    uuid venue_id FK
    date for_date
    text provider
    enum risk "low, watch, likely"
    jsonb hourly
    timestamptz fetched_at
  }
  rainout {
    uuid id PK
    uuid season_id FK
    date on_date
    jsonb scope "fields and times cancelled"
    uuid decided_by FK
    uuid schedule_version_id FK
    int games_affected
    int games_unplaced
  }
```

Notes:
- A `game` is a matchup and keeps its identity for the whole season. Where it is played is a `game_placement` inside a `schedule_version`. Generating, editing or rescheduling creates a new version with its own placements, so any two versions can be compared row by row and nothing is overwritten.
- `game.slot_id` copies the placement from the published version so public pages need one join. It is written only when a version is published, inside the same transaction.
- Team A and team B are neutral names because home and away are decided at the field.
- `game_period` is named for periods, not innings, so a second sport can reuse it.
- Standings are computed from `game` rows on demand and cached (see [architecture.md](architecture.md)). There is no standings table to drift out of date.

### 2.3 Money

```mermaid
erDiagram
  user ||--o{ purchase : makes
  purchase ||--o{ purchase_item : contains
  purchase ||--o{ payment : "paid by"
  payment ||--o{ refund : "returned by"
  promo_code ||--o{ purchase : "applied to"
  user ||--o{ credit_entry : "holds"
  team_season ||--o{ credit_entry : "holds"
  user ||--o{ saved_payment_method : keeps
  season ||--o{ waitlist_entry : queues
  user ||--o{ referral : refers

  purchase {
    uuid id PK
    uuid user_id FK
    uuid season_id FK
    enum status "open, paid, failed, expired, refunded, partially_refunded"
    int subtotal_cents
    int discount_cents
    int credit_applied_cents
    int total_cents
    uuid promo_code_id FK
    text stripe_checkout_session_id UK
  }
  purchase_item {
    uuid id PK
    uuid purchase_id FK
    enum kind "team_fee, player_share, player_fee, free_agent_fee, balance, event_ticket, merch"
    uuid team_season_id FK
    uuid registration_id FK
    uuid event_id FK
    int amount_cents
    text description
  }
  payment {
    uuid id PK
    uuid purchase_id FK
    text stripe_payment_intent_id UK
    text stripe_charge_id
    int amount_cents
    int stripe_fee_cents
    enum status "succeeded, failed, disputed"
    timestamptz paid_at
  }
  refund {
    uuid id PK
    uuid payment_id FK
    text stripe_refund_id UK
    int amount_cents
    text reason
    uuid issued_by FK
  }
  promo_code {
    uuid id PK
    uuid season_id FK
    text code UK
    text stripe_promotion_code_id
    enum kind "percent, amount"
    int value
    int max_redemptions
    timestamptz valid_until
  }
  credit_entry {
    uuid id PK
    uuid user_id FK "one of user or team_season is set"
    uuid team_season_id FK
    int delta_cents "positive grants, negative spends"
    enum reason "rainout_rebate, referral, overpayment, goodwill, spent, expired"
    uuid purchase_id FK
    uuid issued_by FK
    timestamptz expires_at
  }
  saved_payment_method {
    uuid id PK
    uuid user_id FK
    uuid team_season_id FK "the team this card guarantees"
    text stripe_payment_method_id
    text brand
    text last4
  }
  waitlist_entry {
    uuid id PK
    uuid season_id FK
    uuid user_id FK
    text phone_e164 "for visitors with no account"
    text email
    enum kind "team, free_agent, interest"
    enum status "waiting, offered, accepted, expired"
    timestamptz offered_at
    timestamptz offer_expires_at
  }
  referral {
    uuid id PK
    uuid referrer_user_id FK
    uuid referred_user_id FK
    uuid season_id FK
    enum status "pending, credited"
  }
```

Notes:
- `purchase` is our record of what was bought; `payment` mirrors what Stripe says happened. A purchase is marked paid only by the Stripe webhook, never by the browser returning from Checkout.
- A team's balance is its fee minus the sum of paid `purchase_item` rows for that `team_season_id`. It is computed, not stored.
- `credit_entry` is an append-only ledger. A balance is the sum of the deltas. Spending credit writes a negative row tied to the purchase.

### 2.4 Notifications and consent

```mermaid
erDiagram
  user ||--o{ notification_preference : sets
  user ||--o{ sms_consent_event : "consents by"
  user ||--o{ message : receives
  user ||--o{ push_subscription : registers
  announcement ||--o{ message : "fans out to"

  notification_preference {
    uuid id PK
    uuid user_id FK
    enum topic "rainout, schedule_change, game_reminder, payment, sub_request, announcement, score, events, marketing"
    enum channel "email, sms, push"
    bool enabled
  }
  sms_consent_event {
    uuid id PK
    uuid user_id FK
    text phone_e164
    enum action "opt_in, confirm, opt_out, help"
    enum source "web_form, keyword, stop_reply, admin, carrier"
    text disclosure_version "the exact consent text shown"
    inet ip
    timestamptz occurred_at
  }
  message {
    uuid id PK
    uuid user_id FK
    enum topic
    enum channel
    text template
    jsonb payload
    enum status "queued, sending, sent, delivered, failed, suppressed"
    text suppress_reason "no consent, quiet hours, budget, duplicate"
    timestamptz send_after
    text dedupe_key UK
    text provider_message_id
    int segments
    int cost_micros
    int attempts
    uuid announcement_id FK
  }
  announcement {
    uuid id PK
    uuid author_id FK
    uuid season_id FK
    uuid team_season_id FK "null means league-wide"
    text subject
    text body_md
    jsonb audience
    timestamptz sent_at
  }
  push_subscription {
    uuid id PK
    uuid user_id FK
    text endpoint UK
    text p256dh
    text auth
    text user_agent
  }
```

Notes:
- `message` is the outbox. Code that wants to notify someone inserts a row in the same transaction as the change that caused it; a worker sends it. See [architecture.md](architecture.md).
- Current SMS consent is the latest `sms_consent_event` for a phone number. The log is append-only so the league can show when and how someone agreed.

### 2.5 Sponsors, events, community

```mermaid
erDiagram
  sponsor ||--o{ sponsorship : "signs"
  season ||--o{ sponsorship : "sold in"
  sponsor ||--o{ sponsor_member : "managed by"
  sponsor ||--o{ deal : offers
  sponsor ||--o{ checkin : receives
  deal ||--o{ deal_redemption : "redeemed as"
  checkin ||--o| deal_redemption : "may include"
  sponsor ||--o{ sponsor_stat_daily : "measured by"
  season ||--o{ team_of_week : names
  league ||--o{ event : hosts
  event ||--o{ event_rsvp : collects
  season ||--o{ award_poll : runs
  award_poll ||--o{ award_vote : collects
  league ||--o{ post : publishes

  sponsor {
    uuid id PK
    uuid league_id FK
    text name
    text slug UK
    enum kind "bar, restaurant, brand, other"
    bool is_home_bar
    text address
    numeric lat
    numeric lng
    text url
    uuid logo_asset_id FK
    uuid logo_square_asset_id FK
    text checkin_secret "signs the rotating QR code"
  }
  sponsorship {
    uuid id PK
    uuid sponsor_id FK
    uuid season_id FK
    enum tier "home_bar, field, team, supporter"
    uuid team_season_id FK "for team sponsors"
    int amount_cents
    text in_kind_notes
  }
  sponsor_member {
    uuid id PK
    uuid sponsor_id FK
    uuid user_id FK
  }
  deal {
    uuid id PK
    uuid sponsor_id FK
    text title
    text terms
    jsonb valid_days
    time valid_from
    time valid_to
    bool active
  }
  checkin {
    uuid id PK
    uuid sponsor_id FK
    uuid user_id FK
    uuid team_season_id FK
    date on_date
    timestamptz checked_in_at
  }
  deal_redemption {
    uuid id PK
    uuid deal_id FK
    uuid checkin_id FK
    uuid user_id FK
    timestamptz redeemed_at
  }
  sponsor_stat_daily {
    uuid id PK
    uuid sponsor_id FK
    date on_date
    text placement "home strip, game page, sponsor page"
    int impressions
    int clicks
  }
  team_of_week {
    uuid id PK
    uuid season_id FK
    date week_of
    uuid team_season_id FK
    uuid sponsor_id FK
    int tab_cents
    text reason
  }
  event {
    uuid id PK
    uuid league_id FK
    uuid season_id FK
    enum kind "bar_night, bbq, tournament, theme_week, social"
    text title
    text slug UK
    text description_md
    timestamptz starts_at
    timestamptz ends_at
    uuid venue_id FK
    uuid sponsor_id FK
    int capacity
    int ticket_price_cents
    uuid cover_asset_id FK
  }
  event_rsvp {
    uuid id PK
    uuid event_id FK
    uuid user_id FK
    enum status "going, maybe, not_going, waitlisted"
    int guests
    uuid purchase_item_id FK
  }
  award_poll {
    uuid id PK
    uuid season_id FK
    enum kind "weekly_mvp, season_mvp, best_team_name, sportsmanship, custom"
    text title
    timestamptz opens_at
    timestamptz closes_at
  }
  award_vote {
    uuid id PK
    uuid award_poll_id FK
    uuid voter_id FK
    uuid nominee_user_id FK
    uuid nominee_team_season_id FK
  }
  social_account {
    uuid id PK
    uuid league_id FK
    enum provider "instagram"
    text account_name
    text access_token_encrypted
    timestamptz token_expires_at
    enum status "connected, needs_reconnect, disconnected"
    timestamptz last_synced_at
  }
  social_post {
    uuid id PK
    uuid social_account_id FK
    text provider_post_id UK
    text permalink
    text caption
    enum media_type "image, video, carousel"
    uuid asset_id FK "our stored copy"
    timestamptz taken_at
    bool featured
    bool hidden
    uuid team_id FK
    uuid event_id FK
    uuid season_id FK
  }
  post {
    uuid id PK
    uuid league_id FK
    uuid season_id FK
    text slug UK
    text title
    text body_md
    uuid cover_asset_id FK
    timestamptz published_at
  }
```

### 2.6 Referees (pending owner approval)

```mermaid
erDiagram
  user ||--o| referee_profile : "may be"
  referee_profile ||--o{ referee_availability : offers
  game ||--o{ referee_assignment : "officiated by"
  referee_profile ||--o{ referee_assignment : takes
  referee_profile ||--o{ referee_payout : "paid by"
  referee_payout ||--o{ referee_assignment : covers

  referee_profile {
    uuid user_id PK
    enum status "applied, approved, inactive"
    int base_fee_cents
    int games_worked
    int no_shows
    text stripe_connect_account_id
  }
  referee_availability {
    uuid id PK
    uuid user_id FK
    date on_date
    jsonb time_indexes
  }
  referee_assignment {
    uuid id PK
    uuid game_id FK
    uuid user_id FK
    enum status "offered, accepted, declined, completed, no_show, cancelled"
    timestamptz offered_at
    timestamptz responded_at
    int fee_cents
    int bonus_cents
    text bonus_reason
    uuid payout_id FK
  }
  referee_payout {
    uuid id PK
    uuid user_id FK
    int amount_cents
    enum method "cash, venmo, stripe"
    enum status "pending, paid"
    text stripe_transfer_id
    uuid paid_by FK
    timestamptz paid_at
  }
```

The MVP uses only `referee_assignment` with `status = accepted`, created by an admin, so score entry can be tied to it. The rest waits for approval.

### 2.7 Platform

```mermaid
erDiagram
  user ||--o{ audit_log : acts
  user ||--o{ suspension : "may receive"
  game ||--o{ incident : "may have"

  asset {
    uuid id PK
    enum kind "league_logo, team_logo, sponsor_logo, avatar, cover, photo, document"
    text blob_url
    text content_type
    int width
    int height
    int bytes
    uuid uploaded_by FK
  }
  audit_log {
    uuid id PK
    uuid actor_id FK
    text action "for example schedule.publish, payment.refund"
    text entity_type
    uuid entity_id
    jsonb before
    jsonb after
    inet ip
    timestamptz occurred_at
  }
  webhook_event {
    uuid id PK
    text provider "stripe, twilio, resend"
    text event_id UK
    text type
    jsonb payload
    enum status "received, processed, failed"
    timestamptz processed_at
  }
  ai_usage {
    uuid id PK
    uuid user_id FK
    enum feature "rulebook_question, recap_draft"
    text model
    int input_tokens
    int cached_input_tokens
    int output_tokens
    int cost_micros
    text question_hash "for the answer cache"
    jsonb answer "answer text and cited rule numbers"
    timestamptz occurred_at
  }
  incident {
    uuid id PK
    uuid game_id FK
    uuid reported_by FK
    uuid subject_user_id FK
    uuid subject_team_season_id FK
    enum kind "ejection, taunting_warning, conduct, outside_alcohol, injury, other"
    text details
  }
  suspension {
    uuid id PK
    uuid user_id FK
    uuid incident_id FK
    enum scope "games, season, permanent"
    int games
    date starts_on
    date ends_on
    uuid issued_by FK
  }
```

## 3. Constraints and indexes

Integrity rules the database enforces, so application bugs cannot break them:

| Table | Constraint or index | Purpose |
|---|---|---|
| `registration` | unique `(season_id, user_id)` | One entry per person per season |
| `roster_membership` | unique `(team_season_id, registration_id)` where `status <> 'removed'` | No duplicate roster spots |
| `roster_membership` | unique `(registration_id)` where `status = 'active'` | A player is active on one team per season |
| `roster_membership` | unique `(team_season_id)` where `role = 'captain' and status = 'active'` | Exactly one captain |
| `team_season` | unique `(team_id, season_id)` | One entry per team per season |
| `slot` | unique `(field_id, starts_at)`; check `ends_at > starts_at` | No duplicate slots |
| `slot` | exclusion on `(field_id, tstzrange(starts_at, ends_at))` | No overlapping slots on a field |
| `game` | check `team_a_id <> team_b_id` | A team cannot play itself |
| `game_placement` | unique `(schedule_version_id, game_id)` | A game is placed once per version |
| `game_placement` | unique `(schedule_version_id, slot_id)` where `slot_id is not null` | A slot holds one game per version |
| `schedule_version` | unique `(season_id, version_no)`; unique `(season_id)` where `status = 'published'` | One published version at a time |
| `schedule_version` | check `version_no > 0`; check a non-draft version has `published_at` | Versions count from 1; publishing is timestamped |
| `game_placement` | check `locked` only with a `slot_id` | Only a placed game can be pinned |
| `permit_window` | check `ends_at > starts_at` | A permit has a length |
| `blackout` | unique `(season_id, on_date, field_id)`, nulls not distinct | One blackout per date for all fields, and one per field |
| `team_constraint` | check `on_date` or `time_index` is set; check `weight` between 1 and 10 | A constraint says when; weights stay comparable |
| `audit_log` | check `action` matches `area.verb` | Actions stay searchable, such as every `schedule.*` |
| `waiver_signature` | unique `(waiver_id, user_id, season_id)` | One signature per waiver per season |
| `score_report` | unique `(client_id)` | Retried offline submissions are ignored |
| `score_confirmation` | unique `(game_id, team_season_id)` | One answer per team |
| `game_rsvp` | unique `(game_id, user_id)` | One RSVP per game |
| `game_period` | unique `(game_id, period_no, half)` | One row per half-inning |
| `sub_claim` | unique `(sub_request_id, user_id)` | One claim per person |
| `checkin` | unique `(sponsor_id, user_id, on_date)` | One check-in per bar per day |
| `award_vote` | unique `(award_poll_id, voter_id)` | One vote per poll |
| `message` | unique `(dedupe_key)` | The same notice is never sent twice |
| `webhook_event` | unique `(provider, event_id)` | Webhooks are processed once |
| `payment`, `refund`, `purchase` | unique on each Stripe ID | Stripe retries cannot double-record |
| `credit_entry` | check that exactly one of `user_id`, `team_season_id` is set | Credit has one owner |

Indexes for the common reads:

| Table | Index | Serves |
|---|---|---|
| `game` | `(season_id, status)`, `(team_a_id)`, `(team_b_id)`, `(slot_id)` | Schedule, team pages, standings |
| `slot` | `(season_id, starts_at)` | Schedule by date |
| `game_placement` | `(schedule_version_id)` | Loading a version |
| `roster_membership` | `(team_season_id, status)`, `(registration_id)` | Rosters, "my team" |
| `registration` | `(season_id, status)`, `(user_id)` | Admin lists, "my seasons" |
| `purchase_item` | `(team_season_id)`, `(registration_id)` | Team balance, who has paid |
| `message` | `(status, send_after)` where `status = 'queued'` | The outbox worker |
| `message` | `(user_id, created_at desc)` | Delivery history |
| `audit_log` | `(entity_type, entity_id, occurred_at desc)`, `(actor_id, occurred_at desc)` | History of a record, history of a person |
| `checkin` | `(sponsor_id, on_date)` | Sponsor report |
| `sms_consent_event` | `(phone_e164, occurred_at desc)` | Current consent |
| `game_rsvp` | `(game_id, team_season_id)` | Captain's RSVP board |
| `event` | `(league_id, starts_at)` | Calendar |
| `weather_snapshot` | `(venue_id, for_date, fetched_at desc)` | Latest forecast |

## 4. Personal data

| Data | Where | Who can read it |
|---|---|---|
| Email, name | `user`, `profile` | The person, their captain, admins |
| Phone | `profile`, `sms_consent_event` | The person, admins, their captain; teammates only if `shares_contact` |
| Birth date | `profile` | The person and owners. Everyone else sees only "18+ confirmed" |
| Gender and lineup gender | `profile` | The person, their captain (for lineups), admins |
| Emergency contact | `profile` | The person, their captain, admins |
| Waiver signature, IP address | `waiver_signature` | The person, owners |
| Payment card | Never stored. Stripe holds it; we keep brand and last four digits | The person |

Deleting an account removes the profile and anonymizes the user row. Signatures, payments, consent events and audit rows are kept because the league may need them for legal or accounting reasons; the privacy policy says so.
