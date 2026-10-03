# Arabic Journey — architecture and development contract

## Analysis

The application is a personal Arabic vocabulary learner with a multi-user-safe data model. Vocabulary is the central entity; morphology enriches it, reviews schedule it, quizzes measure recall, and statistics aggregate immutable learning events. Offline operation and reminders depend on the authenticated schema, not on a browser timer. Reliability, editable linguistic data, and preservation of original Arabic take priority over automation.

Phase 1 is a navigation and visual foundation only. Zero counts represent an empty collection, not sample learning activity. Later feature routes explicitly identify their development phase. No authentication, database calls, persistence of learning data, service worker, notification permissions, or fake save controls are introduced here.

## Final architecture

- Frontend: semantic HTML, CSS custom properties, ES modules, hash routing, shared UI primitives, feature modules with explicit mount/unmount lifecycles. No build step or framework. Same-origin fonts. DOM textContent for user content; avoid interpolating stored strings into HTML.
- Cloud: Supabase Auth, PostgreSQL, RLS, storage for optional custom audio, transactional RPCs for learning writes, Edge Functions for secrets and scheduled push. Public client configuration is separate from private server environment variables.
- Offline (phase 10): IndexedDB stores per-user cache, durable operation outbox, server revisions, and sync cursor. Write locally and enqueue atomically. Sync on foreground, connectivity return, and supported background sync; do not rely on background sync availability. Clear/switch account caches securely on logout/account changes.
- Synchronization: client-generated entity and operation UUIDs; server operation uniqueness prevents retry duplication. Compare a monotonic row revision before editing. Conflicts retain both versions for explicit resolution; do not silently use last-write-wins. Review events and scheduling updates commit in one server transaction. Keep queued changes until an acknowledged response. Retry with bounded backoff, never discard on an error.
- Notifications (phase 12): Cron calls an authenticated Edge Function. It selects eligible users in their timezone, counts due words, records a unique delivery key, and sends one grouped Web Push message per reminder slot. Store endpoints/keys under user RLS; keep VAPID private key and service-role credentials server-side. Remove expired subscriptions. Service worker opens #/review. Permission is requested only on an explicit user action. Delivery is best effort; dashboard due counts remain authoritative.
- Backup (phase 13): versioned full JSON exports include vocabulary, grammar, tags, settings, state and event history. Validate and preview restore, confirm destructive actions, and migrate older formats. CSV is UTF-8 and protects spreadsheet formula cells. Cloud sync is not itself a backup.

## Database design

Phase 2 implementation: `supabase/migrations/202609300001_foundation.sql` is the canonical schema. It has been applied to the dedicated Arabic Journey project. Tables for later phases are present as structural foundations; client writes to vocabulary, learning history, counters and subscriptions remain denied until feature-specific migrations implement safe operations. Profile/name and base language/timezone preferences use column grants and the revision-checked `save_base_settings` RPC. Internal delivery and operation tables live in `app_private`, outside the exposed API schema. Phase 2 uses the locally bundled Supabase SDK and same-browser PKCE magic links (optional OTP if the configured email includes a code), and includes English/Bengali UI localization. Notification, offline, vocabulary and SRS implementations remain in their original phases.

All mutable entities use UUID keys, created_at, updated_at, revision (bigint), and deleted_at where sync needs tombstones. All user-owned tables have user_id NOT NULL referencing auth.users. Composite (id, user_id) uniqueness and matching composite foreign keys prevent child rows from linking to another user's parent. User settings/profile use user_id as primary key. Constraints validate required meanings, allowed types, nonnegative counters, schedule values, and morphology shape.

| Table | Main fields and purpose |
| --- | --- |
| profiles | user_id, display_name; private user profile, separate from Auth credentials |
| words | id, user_id, original arabic_word, normalized_arabic, Arabic/Bengali/English meanings, transliteration, type, root letters (text[]; 3 or 4 when provided), root meaning, wazn, verb_form, masdars (text[]), base verb forms, participles, example and translations, notes, favorite, needs_details, custom_audio_path, morphology JSONB, conjugations JSONB, linguistic_provenance |
| word_review_state | word_id, user_id, algorithm, algorithm_version, schedule_version, stage, interval_days, next_review_at, last_reviewed_at, review/correct/incorrect/success counts, weak_score, mastery_status; unique word + algorithm so future adaptive state cannot destroy fixed state |
| tags | id, user_id, name, kind (tag/deck), normalized name; unique active name per owner and kind |
| word_tags | user_id, word_id, tag_id; composite primary key and same-owner foreign keys |
| review_history | id, user_id, word_id, operation_id, occurred_at, received_at, algorithm/version, schedule snapshot, prior stage/interval/due, rating, new stage/interval/due, response_ms, session_id, activity mode; append-only event records |
| quiz_sessions | id, user_id, operation_id, started_at, completed_at, timezone, settings snapshot, score, question_count |
| quiz_answers | id, user_id, session_id, word_id, operation_id, question type, question/expected answer snapshot, submitted answer, correctness, response_ms; preserves context after word edits |
| study_sessions | id, user_id, operation_id, kind, started_at, completed_at, timezone, local_study_date, activity counts; review practice records explicitly distinguish scheduled from unrecorded practice |
| user_settings | user_id, timezone (IANA), revision_algorithm, versioned revision_schedule JSONB, rating behavior, mastery thresholds, daily goals, quiz options, Arabic display/size, future prefix, reminder slots/preferences, appearance, onboarding progress |
| push_subscriptions | id, user_id, endpoint (unique), p256dh, auth key, enabled, last_seen_at; never expose other users' endpoints |
| sync_operations | user_id, operation_id, payload_hash, result, applied_at; unique owner + operation; validates retried payload matches original |
| notification_deliveries | user_id, local_date, reminder_slot, status, attempt_count, sent_at; unique delivery key and controlled retry/lease; server access only |

### Morphology/conjugation choice

Hybrid: common searchable fields stay typed columns; irregular noun/adjective forms, synonyms and antonyms use bounded JSONB. Conjugations use a validated JSONB object keyed by **stable pronoun IDs**, not Arabic labels (dual masculine/feminine labels repeat). Fourteen IDs contain manually editable past and present values; imperative is relevant only to applicable persons. Future is derived for display from the present and chosen prefix, not persisted as a separate tense. This avoids many joins during offline editing while preserving queryable roots/types/masdars. No automatic conjugation assumptions; missing data remains missing. Original diacritics are preserved; normalization is a derived search value with a versioned rule shared by client and server.

### Indexes and access

Plan indexes on words(user_id, created_at DESC), (user_id, word_type), (user_id, normalized_arabic), favorites and active/deleted filters; review state(user_id, next_review_at), (user_id, weak_score DESC); events(user_id, occurred_at DESC); word_tags(user_id, tag_id). Add trigram GIN indexes for meaningful multilingual text searches after query profiling. Pagination is required; no rendering of thousands of rows. Database duplicate detection warns, but normalized Arabic is **not unique** because legitimate homographs exist.

RLS for SELECT/INSERT/UPDATE/DELETE checks auth.uid() = user_id with both USING and WITH CHECK as relevant. Events are append-only through constrained transactional functions; deletion of learning history requires a dedicated confirmed action. Server-maintained counters cannot be arbitrarily overwritten by clients. Secure SECURITY DEFINER functions use a pinned search_path and explicit ownership checks. Authenticated users cannot access sync/delivery records belonging to others. Restrict grants, apply least privilege, and test two-user isolation in phase 2. No service-role, VAPID private, or AI key belongs in frontend files. Deploy with HTTPS, CSP and security headers; client validation is complemented by database constraints.

### Phase 3 implementation

`js/vocabulary.js` mounts/unmounts vocabulary, entry, favorites and tag pages; `js/vocabulary-data.js` uses the authenticated Phase 2 client. Hash query parameters identify word details and edits. Cloud pages request only 25 summary words per page, loading full details separately. User content uses textContent and bypasses interface translation. Memory drafts survive route/language changes and failed saves; account changes clear them. Offline persistence remains Phase 10.

The additive `202609300002_vocabulary.sql` migration enables only constrained vocabulary RPCs. Direct table writes remain denied. `vocabulary_write` pins its search path, checks ownership and expected revisions, validates active owned tags, locks account mutations, and atomically records word/tag changes plus an idempotent operation result. Soft deletion preserves vocabulary, grammar and learning history. Future due queries must exclude deleted words. `vocabulary_list` runs under RLS with literal search and bounded pagination. An active owner/creation/UUID index supports stable ordering.

Phase 3 derives a version-1 NFKC/diacritic/Tatweel comparison solely for duplicate detection and search, preserving originals; Phase 4 will extend shared linguistic utilities/display controls. Type/new/needs-details/favorite/tag/creation-date filters work now; learning-state/root controls follow their own phases. Details preserve future morphology columns without adding their editors. Dashboard collection counts/recent words use real owned data; learning statistics remain deferred. Opt-in demo vocabulary is real editable data, never an automatic dashboard fixture. See `docs/phase-3-testing.md` for live rollback audit and isolated browser verification.

### Phase 4 implementation

`js/arabic-utils.js` defines the stable pronoun IDs, root/list parsing, original-preserving Harakah display, derived future and configurable comparison. Client/server normalization uses NFKC, the same Arabic mark ranges, Tatweel removal and an explicit whitespace class; non-breaking spaces are converted by NFKC only when Unicode normalization is enabled. Defaults retain the version-1 comparison used by Phase 3. Optional strict controls affect search, while duplicate detection keeps the stable default. Quiz comparison/reveal helpers are ready without introducing a quiz UI.

`js/morphology.js` mounts conditional full-entry/detail fields and a semantic conjugation table. It renders compact authored rows or all 14 stable IDs; six second-person IDs expose imperative editing. Future has no persisted tense field. Known noun/adjective values live in bounded JSONB. Existing unknown morphology metadata is retained. Full drafts track grammar edits across type/language changes, including newly authored inactive forms; Quick Add does not replace grammar.

Migration `202609300003_morphology.sql` wraps the existing vocabulary transaction core in a private, client-inaccessible function. The public wrapper validates grammar, preserves owner/revision checks, and includes all grammar in operation hashes/results. Type changes archive inactive verb fields in `morphology._verb`; returning to a verb restores them and removes the archive. Noun fields remain retained when inactive. Duplicate warnings roll back preparatory type changes without advancing revisions. Any later constraint failure rolls back the entire word/tag/operation transaction. A save can advance the monotonic revision more than once because it uses the existing triggers inside one transaction; consumers compare returned revisions and do not assume increments of one.

New bounds enforce 3/4 Arabic root letters, lists of up to 20 items of 200 characters, and bounded JSONB grammar. NOT VALID checks preserve existing rows at migration time and validate future writes. `save_arabic_display` changes only the authenticated owner's Harakah/font/future settings with expected revisions. Direct grammar writes and later learning-state writes remain denied. The extended paginated `vocabulary_list` retains old optional calls and adds exact root/normalization filters without RPC overload ambiguity. See `docs/phase-4-testing.md` for local and live evidence.

### Phase 5 implementation

The fixed engine is algorithm v1. Stage 0 (displayed as stage 1) initially uses the first configured interval, scheduled from word creation. Good advances one stage, Easy advances one plus `easy_skip`, Hard retains the stage and uses `ceil(configured_interval * hard_factor)` with a minimum of one day, and Again resets to stage 0 using `again_days`. Stage equal to interval count is the repeating long-term stage. Default settings are intervals `[1,3,7,15,30]`, repeat 30, Again 1, Hard 0.5, Easy extra skip 1. Rules permit 1–30 positive whole-day intervals of 1–3650 days, including a custom order; the server validates settings and advances schedule versions. A shortened schedule clamps the old stage to its new long-term boundary on the next review. Dates use elapsed 24-hour arithmetic in UTC rather than local-midnight arithmetic, preventing DST from changing interval length.

Migration `202609300004_fixed_srs.sql` initializes only missing active fixed states, adds an insertion trigger for new vocabulary, and preserves original word timestamps, existing state and adaptive records. An unreviewed fixed state remains “new” in vocabulary filters. Due queries use server time, active-word joins, stable ordering and 25-row pagination; the dashboard displays real due counts and five upcoming dates. Word details display current state and the latest 25 append-only events; the full history page remains Phase 9.

`fixed_review` locks the owner operation, vocabulary mutation and fixed state, checks revisions and active ownership, and records state/history/ledger in one transaction. Exact retries return the original result even if the word later changes; reused UUIDs with different payloads are rejected. Server time is authoritative. Scheduled activity requires the word to be due; `recorded_practice` explicitly opts into a scheduling update before its due date. Unrecorded practice makes no call. Events capture prior/new stage, interval/due, response time, algorithm v1, schedule and rating snapshots. Legacy events retain their existing values; the new rating snapshot is nullable only to preserve them. Authenticated clients have no direct history/state writes. There is no arbitrary timestamp, stage, counter or next-review input.

Counters distinguish Again (incorrect), Hard/Good/Easy (correct), and Good/Easy (successful). Preliminary weak evidence adds 1 for Again, 0.5 for Hard and removes 0.5 for Good/Easy down to zero; Phase 8 will introduce the complete configurable evidence model and mastery thresholds. Long-term fixed states are “reviewing”, not automatically mastered. Settings saves do not rewrite existing due dates/stages/history; the next review uses the current snapshot. Conflict forms keep the draft and use the shared accessible confirmation dialog to reload after the account request completes. Drafts clear on account changes. `js/srs.js` is a pure counterpart for previews/tests, `js/srs-data.js` is the owner-guarded transport, `js/srs-settings.js` and `js/srs-details.js` handle presentation. Review session UI is deliberately Phase 6.

## Final folder structure

Create modules only when their phase begins, rather than empty implementation files.

```text
index.html
css/app.css
css/responsive.css
js/app.js                 # bootstrap, route mounting
js/router.js
js/ui.js                  # icons, safe DOM components, modal
js/pages/dashboard.js
js/pages/future.js         # explicit phase availability information
js/supabase.js            # phase 2
js/vocabulary.js          # phase 3
js/arabic-utils.js         # phase 4
js/morphology.js           # phase 4 editors and presentation
js/srs.js                 # phase 5
js/srs-data.js            # phase 5 cloud commands/queries
js/srs-settings.js        # phase 5 schedule editor
js/srs-details.js         # phase 5 state/history display
js/review.js              # phase 6
js/quiz.js                # phase 7
js/statistics.js          # phase 9
js/storage.js             # phase 10 IndexedDB
js/sync.js                # phase 10
js/notifications.js       # phase 12
js/settings.js            # settings added with their feature phases
fonts/                    # self-hosted Lateef and Bengali fonts + licenses
icons/
manifest.webmanifest
service-worker.js         # phase 11, push handlers phase 12
supabase/migrations/      # phase 2 onward
supabase/functions/       # phase 12 onward
docs/architecture.md
docs/phase-1-testing.md
scripts/serve.mjs          # development server only
README.md
package.json
```

## Roadmap and dependencies

Keep the requested sequence intact:

1. Foundation — shell, responsive UI, fonts, routing, empty dashboard, components, manifest structure.
2. Supabase — Auth, schema migrations, RLS, settings and indexes. Requires project URL/public key and redirect configuration.
3. Vocabulary CRUD — quick/full entry, details, edit/delete confirmation, favorites, tags, notes, search/filter, duplicate decisions. Create UUIDs from the start.
4. Morphology — conditional fields, validated editable conjugations, normalization, Harakah display.
5. Fixed SRS — versioned schedules, rating behavior, transactional immutable history, due calculation.
6. Review — preview, flashcards, ratings, shortcuts and session completion.
7. Quiz — saved-data eligibility per question type, scoring and mistake review; never invent missing grammar.
8. Weak/mastered — configurable evidence-based scores and thresholds; mastered remains scheduled.
9. Statistics/history — derive timezone-aware aggregates, streaks, activity calendar and lightweight charts.
10. Offline/sync — IndexedDB, durable outbox, conflict UI, tombstones, idempotent RPCs, multi-device testing.
11. Full PWA — service worker, caching/versioning, PNG icons, install controls and safe updates.
12. Push — consent, subscriptions, VAPID, cron/Edge Function, local-time delivery, batching and retries.
13. Import/export — full backup/restore, CSV validation/preview, bulk paste and explicit duplicate policies.
14. Final QA — devices, RLS, retention, recovery, scheduling, performance and accessibility.

Schema design anticipates all phases; implementation does not cross phase boundaries. Demo verb/noun/adjective fixtures start with vocabulary development, never fake dashboard totals. Onboarding waits until its schedule, reminder, permission and add-word steps work. Schedule interval semantics must be agreed during phase 5: intervals between reviews vs offsets from creation; default plan is intervals between successful reviews. Changes are versioned and do not rewrite history.

## Major risks

- Cloud/network failures: pending local writes, replay safety and export recovery require failure-injection tests; never promise that storage cannot fail.
- Concurrent offline reviews: retain both events and deterministically reconcile state transactionally; never apply a stale next-review date blindly.
- Account isolation: per-user IndexedDB partitioning and parent ownership constraints matter as much as individual-table RLS.
- Timezones/DST: timestamps are UTC, calendar dates are calculated in the saved IANA timezone; server and browser must use the same day boundary.
- Reminder delivery: installation, browser support, permissions, OS throttling and network affect push. No promise of exact-time delivery. Cron infrastructure/secrets must be configured.
- Linguistic correctness: homographs, weak/irregular/quadriliteral verbs, and broken plurals require editable data. Harakah removal is for presentation/search only.
- Sync/cache upgrades: version both backup and local schema; preserve pending operations during upgrades and service-worker replacement.
- Privacy: authenticated API responses are not stored indiscriminately in a shared service-worker cache; protect audio access too.

## References

- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Apple Web Push platform requirements: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- MDN Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API


## Phases 6–14 release candidate (2026-10-01)

The user authorized the remaining phases together. Feature modules now implement review, authored-data quiz, evidence/mastery, statistics, IndexedDB/outbox, PWA, push server and backup. Existing phase 1–5 RPCs and Arabic morphology are retained. New migrations 005–012 are additive; full restore is a separate explicitly confirmed transaction and is never run by a migration.

Quiz sessions persist server-generated question/answer snapshots, and quiz completion recomputes correctness on the server. Evidence counters update through triggers on transactional reviews/quiz answers; changing mastery preferences re-evaluates classification without changing due dates. Statistics use the account's IANA timezone. IndexedDB partitions by owner, preserves operation UUIDs and explicit revision conflicts, and archives versions when the learner chooses a resolution. Cache refresh is paginated and coalesced; a shared worker caches only static application assets. There is no service-role, VAPID private or cron secret in runtime files.

Migrations 005–012 were applied to the production project on 2026-10-01. The reminder Edge Function, server secrets, Vault secret and once-per-minute cron are configured. The live two-user transaction audit passed and rolled back all test data; the original two words remain. Phases 6–13 are published to GitHub Pages. Phase 14 remains incomplete: browser control fails before any tab opens, and real browser/mobile installation, offline recovery and notification delivery need manual verification. See [testing and limitations](remaining-phases-testing.md) and [push deployment](push-deployment.md).

### Dashboard activity — 2026-10-03
Dashboard summary rows and daily metrics link to their matching category, review history or quiz. Learning/reviewing/today vocabulary filters run server-side (and in the offline cache); today uses the account timezone. Quiz questions today counts saved quiz answers against the configured daily goal, including answers beyond the goal.
Recent activity renders actual word creation, review and saved quiz answer counts over 7 or 30 days, including zero days. Date links open the private paginated activity_history RPC with date and optional event-kind filters. Deleted-word creation events are retained consistently with the statistics calendar. Existing learning_history and prior feature contracts remain unchanged. Migration 202610030015 was applied individually and checked with rolled-back live fixtures.

### Verb table and Arabic reading update — 2026-10-03
Conjugation display and editing use separate pronoun/past and pronoun/present-future tables. On phones they remain two-column tables and stack by tense. Compact view includes saved pronouns; expanded view includes all 14 pronouns with translated meanings and a separate six-pronoun imperative table. Switching views preserves draft edits. Derived future display is removed; stored present forms and existing backend grammar contracts remain intact. Arabic MCQ answers use a separate Arabic text span, minimum 38px Lateef font and generous line height; prompts use at least 42px.
