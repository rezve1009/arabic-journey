# Phase 5 verification — 2026-09-30

Fixed SRS only; Phases 1–4 and English–Bengali localization retained. Flashcards, keyboard ratings and session completion are Phase 6.

## Automated verification

`npm test`: seven tests PASS. JavaScript syntax checks PASS. Tests use real PostgreSQL via development-only PGlite.

- Default Good intervals advance 3, 7, 15, 30, then repeat 30; initial due is creation plus one day. Again, Hard, Easy and custom short/repeating schedules match the JavaScript transition. Elapsed-day arithmetic includes a DST-boundary example.
- Backfill initializes existing words without editing original vocabulary. New-word insertion uses current settings. Unreviewed states remain new; reviewed fixed states leave the new filter. An independent adaptive state remains byte-for-byte unchanged after fixed ratings.
- Atomic event/state/operation write, exact retry replay, changed-operation rejection, stale revisions, early scheduled denial and explicitly recorded practice. Response milliseconds and algorithm/schedule/rating snapshots are retained.
- Injected state-update failure rolls back the inserted history and acknowledgment ledger, leaving the state unchanged.
- Versioned custom schedule saves, invalid stage/rating settings, stale settings, and preservation of old due dates/history after edits.
- Client history update/delete and counter writes denied, cross-owner access denied, anonymous RPCs denied; deleted words leave due/upcoming queries while history survives.
- 1,000 due words return accurate totals and stable separate 25-record pages. Phase 3 vocabulary and Phase 4 morphology audits also pass under the new schema.

## Browser verification

Used the disposable, clearly labeled PostgreSQL account at localhost:5174. It now starts in a loading state until real fixture settings are fetched, matching production initialization. `node scripts/test-vocabulary-server.mjs` starts it; Ctrl+C discards the database. No real learner credentials were used.

- Saved a Quick Add word: original word persisted and its first due date/state appeared in details.
- Added, moved and removed a stage; reset the draft; saved a custom first interval and repeat value. Draft values survived Bengali → English toggle; reload retained saved values. Existing word due date stayed unchanged after the schedule save.
- Seeded Good/Hard recorded-practice events via the disposable API helper `node scripts/seed-srs-ui-test.mjs <word-uuid>`; verified current state, ordered immutable history, response time, activity mode and derived upcoming dashboard date.
- A stale settings save in a second tab retained its unsaved stage value. Accessible reload confirmation restored the current saved value after the fetch completed.
- 1440px desktop and 390px mobile verified. Mobile scroll width 375px (vertical scrollbar), no horizontal overflow. Bengali labels, rating fields and controls remain usable.
- The final recovered test tab had no warning/error console entries. Real localhost:5173 is signed out and its vocabulary gate remains intact.

Evidence: [settings](phase-5-settings.jpg), [mobile](phase-5-mobile.jpg), [word history](phase-5-history.jpg).

## Live database

Applied `202609300004_fixed_srs.sql` once to the dedicated **Arabic Journey** project (`xtjtpkklmabtookelhrz`) through the logged-in SQL Editor. Result: “Success. No rows returned.” The [rollback-only live audit](../supabase/tests/fixed-srs.sql) returned PASS for initialization, settings versions, immutable history, retry, stale/early protection and owner isolation. All test fixtures rolled back. Earlier migrations were not rerun; the unrelated purchase project was untouched.

Evidence: [migration](phase-5-migration.jpg), [live PASS](phase-5-live-audit.jpg). Baseline already-applied migrations before a future Supabase CLI push; do not rerun them.

## Remaining manual checks

Own-account email delivery/session restoration and schedule persistence through a real learner sign-in remain manual because localhost:5173 is signed out. Phase 6 will verify the actual rating controls/session UI against this engine. Offline outbox/conflict reconciliation is Phase 10; adaptive SRS is future work. No notification permission or push setup occurred.

## Files changed

New: `js/srs.js`, `js/srs-data.js`, `js/srs-settings.js`, `js/srs-details.js`, `supabase/migrations/202609300004_fixed_srs.sql`, `supabase/tests/fixed-srs.sql`, `tests/srs.test.mjs`, `scripts/seed-srs-ui-test.mjs`, this document and its five evidence images.

Updated: `js/settings.js`, `js/supabase.js`, `js/vocabulary.js`, `js/pages/dashboard.js`, `js/i18n.js`, `css/app.css`, `scripts/test-vocabulary-server.mjs`, `tests/browser-account.js`, `README.md`, `docs/architecture.md`.

Recommended commit: `feat: add versioned fixed SRS and review history`.

Next: Phase 6 only — preview, flashcards, reveal, ratings, keyboard controls, progress and session completion.
