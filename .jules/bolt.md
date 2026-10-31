# Bolt's Journal - Critical Learnings

## 2026-04-01 - Fast-path regex checks for HTML escaping in DOM-heavy apps
**Learning:** In Vanilla JS applications that render tables and cards via string templates and `innerHTML`, utility functions like `escapeHtml` (`nexusEsc`) are called thousands of times per page render. Running `.replace()` with regex closures on every cell execution causes unnecessary regex engine overhead and callback function allocations, even though >90% of rendered data strings contain no HTML special characters (`&`, `<`, `>`, `"`, `'`, `` ` ``, `=`).
**Action:** Always place a lightweight regex test `if (!/[&<>"'`=]/.test(str)) return str;` before string replacement in hot output-escaping helpers to double throughput (>50% time saved).

## 2026-04-01 - Pre-indexing localStorage entities into Map for O(1) row lookups during renders
**Learning:** In Vanilla JS applications that query entity relationships (such as resolving container codes from UUIDs during table filtering and row rendering), helper functions like `resolverCodigoContainerLegivel` can end up calling `JSON.parse(localStorage.getItem(...))` and linear `Array.find()` calls hundreds of times per render/keystroke. Pre-indexing `localStorage` array items into a Map once per render cycle reduces lookup time from O(N * M) JSON deserialization cycles to O(1) Map lookups.
**Action:** Always instantiate pre-indexed Maps (e.g. `mapaConts`) at the top of render/filter loops and pass them to identifier resolution helpers.

## 2026-04-01 - Marking evaluated elements in MutationObserver global scanners
**Learning:** Global MutationObserver callbacks that scan inputs or elements (e.g. for auto-formatting or auto-binding events) can easily become a performance bottleneck if non-matching elements are left unflagged. Unflagged elements are re-queried, re-concatenated, and re-evaluated against rules on every single DOM mutation across the page.
**Action:** Always query using `:not([data-flag="1"])` and explicitly set `element.dataset.flag = '1'` on ALL evaluated elements (even when no rule matches), ensuring MutationObserver scans return 0 elements in O(1) time once initial scanning is complete.
