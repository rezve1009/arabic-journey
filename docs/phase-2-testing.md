# Phase 2 — completed foundation and verification

## Implemented

- Dedicated Supabase project public configuration, local SDK, email magic-link sign-in with PKCE, optional OTP, sign-out and session handling.
- Profiles and base settings, transactional revision-safe saves, friendly errors and clear account/loading states.
- English–বাংলা interface toggle with device persistence and authenticated preference saving. Original Arabic and user values remain unchanged.
- 11 public tables plus 2 private server tables, indexes, constraints, auth initialization trigger, RLS, column grants and same-owner foreign keys. Future-feature tables have read access for owners but no client writes yet.

## Cloud setup record — September 30, 2026

- Project: **Arabic Journey** (`xtjtpkklmabtookelhrz`), separate from the existing FFBD project. The user completed database-password entry and project creation.
- The canonical migration was run through the authenticated Supabase SQL Editor. Result: **Success. No rows returned.**
- A separate two-user transaction-scoped SQL audit returned **PASS** for ownership, anonymous denial, protected counters, atomic saves and stale-write rejection. Fixtures were rolled back; no learner words, passwords or test accounts remain.
- Email Auth endpoint returned HTTP 200 and email sign-in enabled; unauthenticated REST access to profiles returned HTTP 401.
- Site URL and exact allowed callback: `http://localhost:5173/index.html`.
- No SMTP credentials, service-role key, VAPID key or database password were read into or stored in the app. Only the publishable key was copied into browser configuration.
- Free-plan default email template is used. Custom SMTP or a plan with template customization is needed before using an OTP-only email template. No upgrade was performed.
- SQL Editor application does not register Supabase CLI migration history. If introducing CLI deployment later, baseline version `202609300001` after verifying the deployed schema; do not re-run this create-only migration.

## Automated and browser checks

`npm test` passes the PostgreSQL migration/security suite and public-configuration validation suite. Database tests check existing/new profile initialization, default settings, root/conjugation/schedule/timezone constraints, all application tables' RLS flags, user isolation, anonymous denial, protected columns, atomic saves, rollback and stale revision handling.

Browser verification passed for all 13 routes in both English and Bengali, persisted Bengali after reload, mobile More navigation, rejection of a dummy private key without storing it, and cleanup/friendly error on a callback with no matching PKCE verifier. Bengali Settings showed no horizontal overflow at 320, 390, 768 and 1440px. No browser warnings/errors were reported during the final checks. Local Supabase SDK, font, CSS and JavaScript resources loaded successfully. Signed-in profile controls still require the real-account manual checks below.

Proof: [Bengali Settings](phase-2-settings-bn.jpg), [migration success](phase-2-migration.jpg), [live security audit](phase-2-rls.jpg).

## Before Phase 3

1. Start `npm run dev`; open Settings.
2. Use your Supabase organization-member email with the default sender. Request one sign-in link and open it in the same browser. Supabase's default email rate limits apply. For another learner address, configure custom SMTP first.
3. Confirm your email appears, set a display name and `Asia/Dhaka` timezone, then save. Reload and check they persist.
4. Toggle English–বাংলা while signed out and reload; then while signed in and reload. Check dashboard, More menu, Settings and messages in both languages. Arabic must retain its original RTL text.
5. Edit preferences in two tabs. Save in one and attempt the stale save in the other; expect a conflict with the unsaved draft retained. Reload only after confirming you can discard your draft.
6. Sign out. Confirm profile data disappears from the page; sign in again and check restored preferences.
7. Check errors for invalid/expired email links or codes, denied recipient/rate limits, missing schema, offline saving and failed connections. Cloud failures must not be labelled as successful saves.
8. Check 320px mobile, keyboard/focus and Bengali line wrapping on your physical devices.

Live email delivery, a real learner's sign-in/session refresh and physical-device behavior are manual checks, not claimed as automated results. No review, quiz, offline sync, install or notification implementation was added.

## Files changed

Modified: `index.html`, `css/app.css`, `css/responsive.css`, `js/app.js`, `js/pages/dashboard.js`, `js/pages/future.js`, `package.json`, `README.md`, `docs/architecture.md`.

Added: `js/config.js`, `js/supabase.js`, `js/settings.js`, `js/i18n.js`, `package-lock.json`, `scripts/vendor-supabase.mjs`, `vendor/supabase.js`, `vendor/SUPABASE-LICENSE.txt`, `vendor/README.md`, `supabase/migrations/202609300001_foundation.sql`, `supabase/tests/rls.sql`, `tests/database.test.mjs`, `tests/config.test.mjs`, this checklist, and Phase 2 screenshots in `docs/`.

Recommended commit: `feat: add Supabase foundation and Bengali UI toggle`.
