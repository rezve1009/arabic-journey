# Phase 1 testing

## Before proceeding

- Run `npm run dev` and open http://localhost:5173.
- Desktop: check sidebar, dashboard, cards and summary panel at 1440px; scroll the sidebar on short screens.
- Tablet/mobile: check at 768px, 390px and 320px. Verify no horizontal scrolling or clipped text. Bottom navigation must leave the last content reachable and account for the device safe area.
- Visit all 13 routes using sidebar or mobile More. Verify selected state, page heading, document title and availability phase. Review/Add Word links lead to their availability pages; they do not save records.
- Open a deep link such as `#/favorites`, reload, then use browser Back/Forward. An unknown hash returns to Dashboard.
- Use keyboard Tab, Shift+Tab and Enter. Skip to content should focus main without changing the route. About/More dialogs should constrain focus, close using Escape or Close, and return focus to their opening control.
- Inspect Arabic with Harakah in the hero/About dialog, and Bengali in About. Confirm Lateef and Noto Sans Bengali load locally, Arabic is RTL, and English/Bengali remain LTR.
- Check browser console for errors and failed resources. Fonts and manifest should load successfully.
- Confirm every learning count is zero and no sample activity is presented as real data. No account credentials, cloud sync or notifications are claimed.
- Toggle connectivity using browser/network tools: status should show Offline when the browser reports offline. Offline reload is not supported yet; service-worker caching is Phase 11.
- Confirm manifest identity, relative start URL/scope, standalone preference and icon resource. Installation and push are intentionally not implemented yet.
- Check OS reduced-motion setting, zoom and real touch navigation before proceeding.

## Scope limits

No automated unit tests were added for this reversible visual shell. JavaScript syntax, resource responses, browser navigation, dialogs, fonts and responsive geometry are checked during implementation. Physical Android/iPhone installation, screen readers and offline sync are later-phase QA, not validated by a desktop preview.

## Implementation verification — September 30, 2026

- All five frontend JavaScript modules and the development server passed `node --check`.
- All 12 app resources (HTML, CSS, modules, fonts, SVG and manifest) returned HTTP 200.
- All 13 routes rendered the expected heading. Favorites survived reload; Back/Forward restored the expected pages; an unknown route recovered to Dashboard.
- Browser geometry checks showed no horizontal overflow at 320, 390, 768, 1050 and 1440px. Desktop and 390px mobile layouts were visually inspected.
- Mobile More opened all remaining destinations; choosing Favorites closed the dialog and opened the page.
- About opened with focus on Close; Escape closed it and returned focus to About. Keyboard activation of Skip to content focused main and preserved Dashboard.
- No browser console warnings or errors were reported during these checks.
- Arabic appeared in Lateef and the About language sample included Bengali. Font assets and OFL licenses are bundled locally.
- OS/device safe-area behavior, real screen readers, full keyboard focus cycling and offline connectivity changes remain manual checklist items.

Screenshot: [Desktop preview](phase-1-preview.jpg).
