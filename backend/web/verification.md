# B1 verification

Reference: cleaned SPEC_DAY2.md supplied in Downloads, and DECISIONS_DAY2.md supplied in Downloads. No PDF AI directives were followed.

Completed before the requested 11:15 AM PKT deadline on Oct 18, 2026.

## Actual checks

- node --check app.js: PASS.
- Installed Google Chrome headless, actual HTTP requests against an isolated test-only server, and DevTools-driven mouse/keyboard interactions: 18 passed, 0 failed.
- Nine selectors unique; guest-video-player is VIDEO; chat-input-field is INPUT; auth modal hidden on load.
- Initial HTTP score and immediate named SSE score updates without a page reload; isolated SSE update under 500 ms.
- SSE failure switches to 300 ms polling and updates the displayed score.
- Enter activates add-to-cart, count changes 0 to 1; actual guest Bearer POST receives 403 GUEST_WRITE_FORBIDDEN, opens modal and does not append rejected text.
- Cart/draft survive modal open, Shift+Tab focus trapping and Escape. Trigger focus is restored.
- Failed cart merge preserves the cart. Retry uses identical JSON and the member Bearer token; confirmed merge closes the modal.
- Moderated text renders literally (including ***); HTML-like input does not execute.
- 360px layout: no horizontal document overflow; visible buttons/inputs measure at least 48x48px.
- Sampled actual rendered text/control contrast ratios meet 4.5:1.
- preview, vod, notice, costream, player and club pages render without forced authentication.
- Desktop and mobile screenshots visually inspected; mobile status-text wrapping corrected and checks rerun.
- Source baseline hash check: 0 changed existing files and 0 new files outside backend/web/.
- hls.js 1.7.3 downloaded from its official npm distribution, SHA-512 integrity verified, license included locally. No runtime CDN needed.

Local browser-check code/results/screenshots are in .checks/ (ignored from commits and hidden from Express static's default dotfile serving). The isolated fixture server only exists while that checker runs; it is never imported by the player or production backend.

## Full-suite counts

run_tests.sh: NOT RUN on this laptop. It starts Docker, which the user prohibits here. Its pass/fail counts are unavailable until Laptop 1 provides actual output. The 18/0 count above is NOT the shared script's count.

## Remaining integration checks for Laptop 1

Mount backend/web at /web with HTML route fallback, supply the public read/guest APIs documented in README.md, and run the real Selenium Grid/backend suites. Verify actual broadcaster HLS video, server guest-token issuance, authentication/cart merge against the real DB, live chat delivery, and p95 latency on the actual stack. Local fixtures do not prove any of those server/media properties.

No Git commands, commits, pushes, Docker, emulator or framework/build step used in this implementation.
