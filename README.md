# Arabic Journey

A lightweight vanilla HTML/CSS/JavaScript vocabulary learning app. **Phases 1–5 are complete.** Sign in to manage vocabulary, manually authored Arabic morphology and a configurable fixed review schedule. Flashcard review arrives in Phase 6.

## Run locally

Install Node.js if needed. The browser app has no build step and includes the pinned Supabase browser SDK locally. Install development/test dependencies with `npm ci`.

```sh
npm run dev
```

Open http://localhost:5173. Stop the server with Ctrl+C. To use another port, set the PORT environment variable. The included server binds to loopback and is for local development, not production hosting. ES modules require an HTTP server; do not open index.html using file://.

For production, serve the static public app files over HTTPS; exclude scripts, docs, environment files and future Supabase server code. Configure security headers with the eventual auth/network destinations. Hash routes work under a subdirectory without SPA server rewrites.

## Phase 1 scope

- Desktop sidebar, mobile bottom navigation and More menu.
- Empty dashboard, summary cards, progress and clear later-phase screens.
- All 13 specified destinations, deep links, browser history and unknown-route recovery.
- Shared buttons, cards, icons, empty states and accessible native dialog.
- Self-hosted Lateef and Noto Sans Bengali with OFL licenses; RTL Arabic and LTR English/Bengali.
- Manifest structure and scalable SVG brand icon.
- Connectivity indicator describes browser connectivity only, not cloud sync.

Not yet installable or offline-ready: service worker, platform PNG icons and installation controls belong to Phase 11. Vocabulary entry is available in Phase 3; no notification permission is requested. Demo words are opt-in editable vocabulary, never automatic dashboard activity.

## Phase 2: Supabase and language

- Connected to the dedicated **Arabic Journey** Supabase project (`xtjtpkklmabtookelhrz`). Public configuration is in `js/config.js`; Settings can override it on this device. Only publishable/anon keys are accepted. Never paste a service-role or secret key.
- Real Supabase passwordless email sign-in, PKCE callback exchange, optional email OTP verification, session refresh/restore and local-device sign-out.
- Profiles and base account preferences: display name, English/Bengali interface language and IANA timezone. Saves are transactional and check expected row revisions. Conflicts retain the form draft until you choose to reload.
- English–বাংলা header toggle translates navigation, dashboard, feature availability pages, account forms and messages. The preference is retained on this device and automatically saved when signed in; it does not alter Arabic or vocabulary data. Account language is loaded when signing in.
- Planned relational schema, same-user composite foreign keys, indexes, RLS and least-privilege grants. Later learning/history tables exist but have no client writes until their operations are implemented.

### Authentication setup and limits

The migration has been applied and a rollback-only live two-user RLS audit passed. Site URL and the exact redirect allowlist entry are `http://localhost:5173/index.html`. Request the sign-in email from Settings and open its link **in the same browser**. SDK initialization consumes the callback before routing. If your custom email template sends an OTP, use the code field instead. Do not paste sign-in links, tokens or codes into project files.

Supabase's default email sender restricts recipients to organization members and has a low sending limit. Use your Supabase account email for initial testing. Custom SMTP must be configured server-side before broader multi-user use; no SMTP secrets belong in this app. The Free-plan default template sends a magic link; template customization currently requires custom SMTP or a paid plan. No paid plan was enabled. See [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

When deploying or changing the local port, configure the exact new app URL in Supabase Auth → URL Configuration. Use HTTPS for production. This phase does not publish the site.

### Database and tests

Canonical migration: [202609300001_foundation.sql](supabase/migrations/202609300001_foundation.sql). Apply once to a new project, not repeatedly to the configured project. There is no duplicate root SQL dump. SQL Editor execution is recorded below; future Supabase CLI deployments should baseline this migration in their migration history before a push, rather than executing it again.

```sh
npm ci
npm test
```

Tests use real PostgreSQL through development-only PGlite to check schema constraints, RLS, trigger initialization, anonymous denial, protected counters, atomic updates and stale revision rejection. The live [Supabase audit](supabase/tests/rls.sql) uses transaction-scoped fixtures and rolls them back. No login credentials or real learner data are used by these tests. Live email delivery and your actual session must be checked with your own account.

`npm run vendor` reproduces the checked-in browser SDK and MIT license from the pinned npm package. It is needed only when deliberately updating that dependency; runtime pages do not fetch an SDK from a CDN.

## Design and next work

See [architecture and schema](docs/architecture.md) for the full specification analysis, hybrid morphology model, final folder structure, security, offline/push design, all 14 phases and risks.

See [Phase 1 testing checklist](docs/phase-1-testing.md) for verification and manual checks.
See [Phase 2 testing and changed files](docs/phase-2-testing.md) for this phase's verification and remaining account checks.

## Phase 3: vocabulary

Quick/full entry, details, notes, favorites, tags/decks, revision-checked edits, confirmed soft deletion, server search and 25-record pagination are available after sign-in. Duplicate decisions offer Open Existing, Update Existing, Add Anyway and Cancel; Update Existing opens an editable draft for explicit saving. Arabic originals and future morphology fields are preserved.

The additive [Phase 3 migration](supabase/migrations/202609300002_vocabulary.sql) has been applied to the configured project. Safe vocabulary RPCs are available; direct table writes remain denied. A live rollback-only two-user audit passed. Demo vocabulary is opt-in. Drafts remain in memory across navigation/language changes; offline persistence starts in Phase 10.

See [Phase 3 verification and complete file list](docs/phase-3-testing.md). Authenticated UI checks used a disposable PostgreSQL test account, separate from real cloud data. Run `node scripts/test-vocabulary-server.mjs` and open http://localhost:5174 to reproduce them; stopping the process discards its database. Exclude `tests/` and `scripts/` from deployment. Own-account email/session checks remain manual.

## Phase 4: Arabic morphology

Full Add/Edit supports triliteral/quadriliteral roots, root meaning, Wazn, multiple Masdars, Forms I–X, base forms/participles and 14 editable pronoun rows. Imperative inputs exist only for six second-person pronouns. Future is derived from present using the saved `سَ`/`سَوْفَ` preference. No missing conjugation is generated. Compact View shows authored rows; Expanded View shows all fourteen.

Noun/adjective fields cover singular, dual, plurals, broken plurals, masculine/feminine, synonyms and antonyms. Changing type retains hidden grammar. Settings saves Harakah mode and Arabic font size (24–80px) to the account with revision checks; display changes never rewrite original Arabic. Hide During Quiz becomes active with Phase 7 quizzes. Search supports exact roots and optional Harakah/Tatweel/Unicode comparison.

The additive [Phase 4 migration](supabase/migrations/202609300003_morphology.sql) is applied to the dedicated project. Do not execute it again there. Apply migrations 001 → 002 → 003 once each for a new database. See [Phase 4 verification and complete file list](docs/phase-4-testing.md) for tests, browser evidence and remaining own-account checks. No Phase 5 scheduling has been implemented.

## Phase 5: fixed SRS

New words start at stage 1 and become due after one elapsed day by default. Good advances through 3 → 7 → 15 → 30 days, then repeats every 30 days. Again resets to the first stage; Hard retains the stage with a shorter interval; Easy skips ahead. Stage intervals, long-term repeat, Again days, Hard factor and Easy skip are editable in Settings. Adding, deleting, reordering and resetting the schedule draft are supported. Days mean elapsed 24-hour intervals; dates use the saved account timezone.

Saving a schedule creates a new version and preserves existing due dates/history. The next recorded review uses the new settings. Existing active vocabulary with no fixed state is initialized from its original creation time; it may already be due. Existing fixed/adaptive states are preserved at migration time.

The additive [Phase 5 migration](supabase/migrations/202609300004_fixed_srs.sql) is applied to the dedicated project; do not rerun it. Review state, history and operation acknowledgment commit atomically with owner/revision checks. Scheduled reviews reject early ratings; explicitly recorded practice is supported by the engine. Direct history/state writes remain denied. Dashboard due/upcoming data and word details are available now; flashcards, rating controls and session completion wait for Phase 6. No adaptive algorithm, mastery thresholds or push notifications were implemented.

See [Phase 5 tests and changed files](docs/phase-5-testing.md). Apply migrations 001 → 002 → 003 → 004 once each for a new project. The disposable UI test server now loads all four migrations.

## Online hosting

Live site: https://rezve1009.github.io/arabic-journey/

Repository: https://github.com/rezve1009/arabic-journey

GitHub Pages uses the checked-in Actions workflow. Pushing `main` deploys only `index.html`, the manifest, CSS, fonts, icons, JavaScript and the bundled SDK. Tests, scripts, SQL, documentation and environment files are excluded from the hosted artifact. Browser configuration contains only the public Supabase publishable key; learner data remains behind Supabase authentication and owner RLS.

Production authentication callback and Site URL: `https://rezve1009.github.io/arabic-journey/index.html`. The existing `http://localhost:5173/index.html` callback remains allowed for development. Open Settings, enter your email and open the emailed sign-in link in the same browser that requested it. Supabase's default sender is restricted to project organization members; public sign-up requires custom SMTP. Personal email delivery/session verification requires the account owner's inbox.

Future updates: commit changes and run `git push origin main`; inspect the Deploy GitHub Pages workflow before assuming the live site has updated. Database migrations are separate and must be applied once, in order.

Release checks and remaining manual verification are recorded in docs/remaining-phases-testing.md.

## Dedicated sign-in page

Open `#/login` for email/password sign-in, confirmed-email registration, or email-link sign-in. Existing accounts created with a link can sign in by link once and choose Set a password for next time. Passwords are never kept in app drafts or local storage; Supabase manages credentials. Email confirmation and owner RLS remain enabled. Email links must be opened in the requesting browser, or pasted into the trusted-link form there. Only the configured Supabase verification endpoint is accepted. Default Supabase SMTP restricts recipients and template editing; code verification is offered only if the received email actually contains a code.

Authentication wrappers, error guidance and trusted-link validation have automated tests using a fake provider. Actual password authentication and inbox confirmation require the account owner and have not been claimed as tested.

Login rate limits: email-link sending and signup share a 60-second resend cooldown. Provider email-quota errors create a conservative one-hour retry deadline when no Retry-After header is supplied; general request throttling falls back to five minutes. The UI displays a countdown, preserves deadlines across reloads, and blocks duplicate in-flight calls. Only deadline/reason metadata is stored. The configured default SMTP quota cannot be increased without custom SMTP, so this UI does not claim to reset or bypass the provider quota. Existing emailed links remain usable through the paste-link form while sending is paused.


## Remaining phases release candidate

Phases 6–13 implementations and Phase 14 automated checks are ready for the live release. Production additive migrations, reminder Edge Function, Vault/cron and public push configuration were deployed on 2026-10-01. The live two-user rollback audit passed, existing words were retained, and all 19 automated tests passed. Real browser/device QA and actual push delivery remain unverified because browser control cannot start; Version 1 final QA is still open. See [release testing](docs/remaining-phases-testing.md) and [push deployment](docs/push-deployment.md). Run npm test and npm run prepare:pwa before release.
