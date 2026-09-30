# Phase 4 verification — 2026-09-30

Scope: Arabic morphology only. Phases 1–3 and the English–Bengali toggle are preserved. SRS/review/quiz behavior remains scheduled for Phases 5–7.

## Automated checks

`npm test` passes all five tests using real PostgreSQL through PGlite. All JavaScript modules also pass `node --check`.

- Arabic utilities: original text retention, Harakah display/reveal, optional comparison, blank-answer rejection, 3/4-letter roots, multiple forms, derived future, 14 unique IDs and six imperative persons.
- Client/server parity: all eight normalization option combinations across diacritics, Tatweel, presentation forms, tabs/newlines, non-breaking/Unicode whitespace and internal BOM.
- Grammar CRUD: full rows, Forms I–X bounds, lists, invalid roots/imperatives, basic-save retention, type archives and restoration, preserved noun metadata, exact retry acknowledgments and changed-payload denial. A pre-migration Phase 3 retry remains compatible.
- Atomicity: invalid morphology leaves the row unchanged; a constraint failure after basic updates rolls back the word and operation ledger; duplicate warnings undo preparatory type changes and revisions.
- RLS/grants: cross-owner reads/writes denied, anonymous settings RPC denied, private core inaccessible, no SRS/history created. Both Phase 3 and Phase 4 rollback audits pass against the Phase 4 schema.
- Settings: persisted mode/font/prefix, 24–80 bounds, stale revision rejection. Earlier config/Phase 2/Phase 3 suites still pass, including 1,001-record pagination/search.

## Browser verification

Used the disposable PostgreSQL adapter at localhost:5174, never real learner credentials. Start `node scripts/test-vocabulary-server.mjs` to reproduce; it loads all three migrations. Its account is explicitly labeled; stopping the process discards its database.

- Full verb save with root/Wazn/Form I, two Masdars, base forms and manual past/present/imperative rows. Future preview is read-only and derives from present.
- Full editor has 14 rows and exactly six imperative inputs. Noun editor/detail contains no conjugation table. Compact detail shows authored rows; Expanded shows 14 including empty forms.
- Draft Arabic/conjugations survive English → Bengali and type changes. Newly authored noun values survive a save after returning to verb; persisted verb data restores after noun → verb.
- Always Hide with 80px font and sawfa persists in Settings and masks collection/details; edit inputs retain original Harakah. Always Show with 38px restores the original display. Settings in two tabs reject a stale save and retain its unsaved display draft with reload action.
- Exact root filter matches; normalized Tatweel search matches, then strict Tatweel search returns no result.
- 1440px desktop and 390px mobile layouts verified. At 390px, document scroll width is 375px (vertical scrollbar); no horizontal overflow, including at 80px. Mobile table becomes labeled cards. Caption uses full card width.
- No error/warning console entries during the authenticated UI checks. Real local app's signed-out gate remains available.

Evidence: [desktop detail](phase-4-desktop-details.jpg), [desktop editor](phase-4-desktop.jpg), [mobile detail](phase-4-mobile.jpg), [mobile editor](phase-4-mobile-editor.jpg).

## Live database

Applied `202609300003_morphology.sql` once through the logged-in SQL Editor to **Arabic Journey** (`xtjtpkklmabtookelhrz`). It completed with “Success. No rows returned.” The [live audit](../supabase/tests/morphology.sql) returned PASS for grammar retention/retry, roots, settings revisions, owner isolation and protected writes. All audit fixtures were in a transaction ending with rollback; no learner records were retained. Existing foundation and vocabulary migrations were not rerun. The unrelated purchase project was untouched.

Evidence: [migration result](phase-4-migration.jpg), [live audit result](phase-4-live-audit.jpg). Baseline all three already-applied SQL migrations in Supabase CLI history before a future CLI push rather than rerunning them.

## Remaining manual account checks

The actual localhost:5173 app is signed out. Own-account email delivery, session restoration and morphology persistence through a real learner sign-in remain manual; they were not simulated as successful. Sign in in the same browser, save one full word, reload and confirm it and the account's display preferences. Hide During Quiz has utility tests now; its actual question/reveal flow waits for Phase 7. Screen-reader/device QA beyond these desktop/mobile browser checks remains part of final QA.

## Files changed

New: `js/arabic-utils.js`, `js/morphology.js`, `supabase/migrations/202609300003_morphology.sql`, `supabase/tests/morphology.sql`, `tests/morphology.test.mjs`, this document and its six evidence images.

Updated: `js/vocabulary.js`, `js/vocabulary-data.js`, `js/settings.js`, `js/supabase.js`, `js/i18n.js`, `js/app.js`, `js/pages/dashboard.js`, `css/app.css`, `scripts/test-vocabulary-server.mjs`, `tests/browser-account.js`, `README.md`, `docs/architecture.md`.

Recommended commit: `feat: add Arabic morphology and display preferences`.

Next: Phase 5 only — versioned fixed SRS schedules, rating behavior, atomic immutable history and due calculations.
