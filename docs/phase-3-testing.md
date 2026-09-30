# Phase 3 — vocabulary CRUD

Implemented Quick Add, Full Add, revision-checked edits, confirmed soft deletion, paginated vocabulary and favorites, details, notes, tags/decks, multilingual search, filters and all four duplicate decisions. Phases 1–2 and the English–Bengali toggle remain intact. Morphology, SRS, offline storage and learning statistics stay in their planned phases.

## Database

Migration `202609300002_vocabulary.sql` was applied once through SQL Editor to the dedicated Arabic Journey project `xtjtpkklmabtookelhrz`. The foundation migration is unchanged. Baseline both versions before a future CLI push; SQL Editor does not register CLI migration history.

`vocabulary_write` explicitly checks ownership, serializes account mutations, validates fields and same-owner active tags, checks revisions, and atomically commits words, tag links and operation acknowledgements. Direct table writes remain denied. Identical operation retries return their original result; changed payload reuse fails. Deletion creates tombstones and retains immutable learning events. Future review queries must exclude deleted words, even when their preserved review state exists.

`vocabulary_list` uses existing RLS and literal search parameters, returning a count and 25 summary records ordered by creation time and UUID. Details load separately. An active owner/order index supports pagination alongside existing indexes. Two pages plus a search over 1,001 local PostgreSQL fixture records took approximately 55 ms; this is not a cloud latency measurement. Consider trigram indexes after profiling larger live collections.

Duplicate comparison uses a server-owned version-1 NFKC value without Tatweel/Arabic diacritics; original Arabic stays unchanged and normalized values are not unique. This minimum derived comparison supports Phase 3. Broader normalization utilities and Harakah controls remain Phase 4. Existing derived values are backfilled under the revision trigger.

Filters now cover types, new/unreviewed, needs details, favorites, tags/decks and inclusive creation dates in UTC. Root controls belong to Phase 4; due/learning/reviewing/next-review filters need Phase 5; weak/mastered classification needs Phase 8. Search already includes stored roots/masdars without introducing their editor.

## Verified

`npm test` passed all three suites: public configuration/private-key rejection, unchanged Phase 2 schema/settings/RLS, and Phase 3 CRUD/security. Phase 3 checks retry equality and payload reuse, duplicate warnings versus overrides, Arabic/Bengali/English/tag search, tag ownership, atomic rollback, stale revisions, favorites, link tombstones, retained morphology, retained review history after deletion, stable pagination over 1,001 words, literal injection-like input and anonymous/cross-user denial. JavaScript syntax checks passed.

The rollback-only `supabase/tests/vocabulary.sql` audit passed locally and live. Its two temporary Auth identities have no credentials; all words, tags and ledger operations roll back. No test vocabulary was added to the real learner account.

![Live rollback audit](phase-3-rls.jpg)

Browser checks used the actual frontend with an isolated PostgreSQL backend at `localhost:5174`, displaying a disposable-account banner. Only the account/API adapter is replaced. Start with `node scripts/test-vocabulary-server.mjs`; stopping it discards its database. Never deploy that script or `tests/browser-account.js`.

- Quick Add and full edit with examples, notes and type.
- Original Harakah retained; HTML-like notes displayed as plain text.
- English/Bengali toggles preserve unsaved values and vocabulary data.
- Duplicate Cancel preserves an enabled draft; Add Anyway saves a legitimate duplicate. Update Existing opens the existing revision with edited meanings and retained notes; it waits for explicit Save changes.
- Favorites page, deck creation/rename and atomic assignment.
- Delete cancellation, confirmation and collection removal.
- Two-tab stale save keeps unsaved notes; choosing the latest version requires confirmation.
- Opt-in demo verb/noun/adjective records, keeping existing matches.
- Bengali search and clear filters.
- Desktop 1440 × 1000 and mobile 390 × 844; no horizontal overflow, RTL Arabic and mobile navigation.

![Bengali vocabulary in disposable test account](phase-3-vocabulary-bn.jpg)

## Manual follow-up

- Sign in to the real app with your own same-browser email link, save/edit a word and reload. The real app remained signed out during feature UI testing; actual email delivery/session testing remains manual.
- Real Android/iPhone keyboard and screen-reader checks remain device QA.
- Full browser network failure injection remains reliability QA; server retry/rollback behavior is tested.

Drafts are memory-only until Phase 10. Navigation, language changes and failed saves preserve them within the account. Dirty drafts request the standard browser unload warning. Sign-out/account changes clear private drafts. Closing the page or forcing a reload loses unsaved changes; this phase does not claim offline saving.

## Files changed

Created: `js/vocabulary.js`, `js/vocabulary-data.js`, `supabase/migrations/202609300002_vocabulary.sql`, `supabase/tests/vocabulary.sql`, `tests/vocabulary.test.mjs`, `tests/browser-account.js`, `scripts/test-vocabulary-server.mjs`, this document, and `docs/phase-3-{migration,rls,vocabulary-bn,mobile-bn}.jpg`.

Modified: `js/app.js`, `js/router.js`, `js/supabase.js`, `js/i18n.js`, `js/pages/dashboard.js`, `css/app.css`, `README.md`, `docs/architecture.md`. Dashboard collection/recent/favorite/new counts now come from owned cloud records; future learning metrics remain unavailable.

Recommended commit: `feat: implement vocabulary CRUD and duplicate decisions`

Next: **Implement Phase 4 only using the master specification and docs/architecture.md. Preserve Phases 1–3 and the English–Bengali toggle.**
