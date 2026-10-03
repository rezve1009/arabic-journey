
# Phases 6–14 release candidate — 2026-10-01 (Asia/Dhaka)

Status: backend and frontend deployed on 2026-10-01. Phases 1–5 are preserved. Final real browser/device QA remains outstanding. Browser control currently fails before opening a tab with a Windows sandbox setup-refresh error. The automated DOM tests below are not a replacement for screenshots, real browsers, or physical Android/iPhone testing.

## Implemented

- Phase 6: real due preview, original-preserving flashcards, answer reveal, Again/Hard/Good/Easy interval previews, owner/revision guarded saves, session completion, Space/1–4 controls. Random practice offers 5/10/20, weak/recent/verb/noun/tag/deck filters; scheduling changes require explicit opt-in.
- Phase 7: all 12 major question types from authored data only, eligibility checks, randomized distinct MC choices, server-generated snapshots, server scoring, retry-safe completion, mistake review, per-owner durable unfinished quiz drafts.
- Phase 8: Again/Hard/quiz/slow evidence plus low-accuracy component; configurable weights and mastery rules; weak and mastered pagination and sorting; mastered remains scheduled.
- Phase 9: owner-scoped timezone-aware statistics, day/week/month totals, daily goals, accuracy windows, streaks, 365-day activity calendar and paginated date-filtered review/quiz history. Soft-deleted vocabulary still contributes its original study day.
- Phase 10: per-user IndexedDB cache, atomic mutation/outbox writes, operation UUID replay, predecessor revision mapping, bounded retries, foreground/online/background-sync wakeup, conflict comparison and explicit local/server choice, archive of both conflict versions. Offline words and reviews work; starting a server-generated quiz and changing learning settings need connectivity. Logging out requires pending mutations to sync first. Cache snapshots are paged full refreshes, not a change-data-capture feed.
- Phase 11: application-only versioned worker cache, no authenticated API caching, safe waiting-worker activation, install controls, PNG maskable icons and GitHub subpath scope. Asset cache version derives from runtime content. Foreground sync remains the fallback when Background Sync is unavailable.
- Phase 12: explicit notification consent, device subscriptions, grouped messages, local-time slots, service-only lease/finish RPCs, bounded retry/expired-subscription cleanup and authenticated cron Edge Function. No VAPID private or service-role key in browser files. **Live VAPID secrets, Edge Function deployment and Vault-backed cron are configured. Actual device delivery is not verified.**
- Phase 13: versioned full JSON backup, typed RESTORE confirmation with pre-restore download, atomic restore rollback, UTF-8 CSV with formula protection, preview validation, duplicate policy and bulk spreadsheet paste. Unsynced operations are included in offline backup and must be synced before cloud restore; they are never silently discarded. Notification permission/subscriptions are device-specific and must be re-enabled after restore.
- Phase 14: automated PostgreSQL/DOM/IndexedDB/PWA checks added. **Not complete** until the manual release checks below pass.

## Automated checks

Run npm test, syntax-check runtime modules, npm run prepare:pwa and git diff --check. Tests use disposable PGlite PostgreSQL, jsdom DOM simulation and fake-indexeddb. They do not access the learner's account, send mail/push, or mutate live data.

Covered: previous auth/rate/CRUD/morphology/fixed-SRS regression suite; authored quiz eligibility; server scoring and exact retries; owner isolation; backup round trip and atomic failure rollback; Unicode CSV and formula protection; streak boundaries; atomic offline writes and owner partitions; mounted reveal/rating/quiz/stats flow; lost review response and duplicate-free replay; static-only worker caching and safe activation.

## Required release checks

1. Apply only new migrations 005–012 to the dedicated project, then audit RLS/grants using two disposable accounts. Do not re-run foundation migrations already applied through SQL Editor.
2. Browser QA: add/edit/back, flashcards and keyboard shortcuts, all quiz types, conflicts, goals, history date boundaries and Bengali/Arabic rendering. Save screenshots before delivery.
3. Network QA: cache an account, disconnect/reload, add/edit/delete/tag/review, reload with queued writes, reconnect, simulate a lost acknowledgement, concurrent edits/reviews and account switching. Verify both conflict versions remain recoverable.
4. Android install and offline reopening; iPhone/iPad Home Screen considerations; desktop install/update with pending operations; denied notification permission and no Arabic voice.
5. Deploy push server and cron; test two slots, timezone rollover, one grouped reminder, retries and expired subscriptions without disclosing secrets.
6. Import/export: JSON restore rollback, morphology/conjugation/history/settings retention, ambiguous homographs, malformed/oversized files, formula cells, Unicode and partial-import retries.
7. Test a large collection (existing suite exercises 1,001 words), keyboard focus, mobile touch targets and screen-reader labels.
8. Only after backend and UI checks, push the release to main and verify GitHub Pages deployment plus current worker cache version.

## Latest local result

npm test: 19 passed, 0 failed. Runtime/script syntax checks and git diff --check passed. The disposable HTTP fixture returned owned timezone-aware statistics successfully. Live migrations 005–012 succeeded. A transactional live audit verified authored quiz eligibility, owner statistics, cross-user RLS and denied authenticated access to reminder jobs, then rolled back all temporary users/data. The original two words remain and no audit accounts remain. The reminder endpoint returned 401 without its secret and 200 with it (zero jobs). The once-per-minute cron is active, and public push configuration is enabled. Actual device push delivery and physical device/browser UI checks remain unverified.

## Live release verification

GitHub Pages run [36853242739](https://github.com/rezve1009/arabic-journey/actions/runs/36853242739) completed successfully for commit 6c79985. The hosted review/quiz modules, manifest and worker returned HTTP 200; worker cache is arabic-journey-d1e9e16893ed. Cron completed successful runs and its HTTP responses returned 200 without timeouts. These transport/server checks do not claim successful real-device notification delivery or browser UI QA.
## MCQ update — 2026-10-01

Quiz now selects multiple_choice by default, offers MCQ-only and saved-type presets, and renders stable A–D clickable options. Additive migration 013 excludes MCQs without a distinct nonempty authored English distractor instead of silently displaying a typing question. Options are sampled and shuffled once in the stored server snapshot; existing sessions keep their saved questions. Two distinct meanings provide two options, up to four unique meanings provide four. The full suite passed 20 tests, and the extended mounted UI test confirmed button answers advance and save the correct score. Live rollback audit verified one-word ineligibility and two-word MCQs without retaining test users or vocabulary. Browser screenshot and physical-device QA remain unavailable.

## Word navigation and strict MCQ — 2026-10-03

Word details have filter-aware previous/next controls, cross-page boundaries and safe horizontal touch swipes (left advances, right returns). Vertical scroll, controls, text selection and multitouch do not navigate. Quiz setup and learning preferences now use only multiple_choice; old unfinished typing quizzes are archived in owner-scoped local metadata instead of restored into a textbox. Existing learning history is retained. All 22 automated tests passed, including pagination/swipe logic, old draft retention, real MCQ button submissions and offline replay. Browser control recovered: disposable local browser tests verified previous/next word changes and MCQ option submissions; screenshots are saved locally in docs/word-navigation-preview.png and docs/mcq-only-preview.png. These checks do not claim a physical phone swipe test or full Phase 14 completion.
## Multilingual MCQ and visible updates — 2026-10-03

Migration 014 adds owner-scoped authored Bengali→Arabic, Arabic→Bengali, Arabic→English and English→Arabic MCQs. Directions are spread across the selected questions when enough candidates exist; equivalent correct alternatives are excluded from distractors. Answer options have explicit language/direction metadata, and all remain clickable MCQs. Existing saved sessions keep their snapshots. All 22 regression tests passed, including multilingual eligibility/choices/server scoring, real UI answer submission, update banner visibility and refusing activation with queued writes. Live migration and transactional ownership audit succeeded without retaining test data.

PWA registration bypasses HTTP cache for worker update checks, checks at startup/return to foreground, and shows a waiting-version banner on all pages. Settings offers an explicit Check for updates control and current release label. Update app waits for controller change before reloading rather than offering an early Reload app button. A real disposable browser update check detected a changed worker, showed the banner and automatically reloaded after activation. Physical phone verification remains outstanding. On old cached clients, open Settings and use its existing Update app then Reload app controls; simply refreshing can keep the old active worker. Do not clear site data or queued learning writes to update.
