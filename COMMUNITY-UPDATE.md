# Community UI and day-based task update

Implemented locally:
- Persian admin headings and core forms, RTL layout, activity counters and daily-gift report.
- Admin auction duration in seconds instead of calendar input. Existing server auction decrement and accounting preserved. Room creation still reserves the configured prize; no unfunded rooms or arbitrary prize amounts are seeded.
- Per-room fee/prize/countdown and paginated completed-auction summaries.
- Task dayNumber 1–30 and enrollment-day snapshots. Existing open days are not silently rewritten.
- Removal of the 50-percent season purchase gate and misleading milestone claims from the dashboard. Prior-season ownership and no-repeat rules remain.
- Profile statistics, opt-in public summary, sharing and commission leaderboard.
- Language preference selection and channel check at entry; welcome message and editable terms text.

Still outstanding (do not represent as implemented):
- Live verification of the newly added wallet ownership flow with an actual Tonkeeper client. Standard V4/V5 state-init-bound proofs, single-use challenges, atomic 50 GEN replacement fees and explicit UI confirmation are implemented; other wallet contract versions fail closed.
- Membership is now server-enforced for new purchases, task claims, shop purchases and auction bids. Account recovery, existing payments and withdrawals intentionally remain available without membership.
- Independent 24-hour daily gift independent of tasks: current gift remains linked to existing season tasks and existing noon boundary. Countdown reflects its actual deadline.
- Complete Persian localization of all errors, finance controls and user pages; current localization is partial.
- Full terms text supplied by the owner must be saved in admin; fallback is a short notice, not the complete supplied terms.
- Live Telegram/UI-device verification and production deployment.

New schema: migrations/20260908160000_community; requires prior task_conditions schema. Production has no migration baseline; review schema updates after backup rather than blindly deploying every migration.
Environment flags and financial worker modules were not changed. Season eligibility/day selection changed intentionally per the current user request.

Wallet proof reference: https://docs.ton.org/applications/ton-connect/how-to/ton-proof
Wallet replacement updates the profile's verified wallet only; it does not redirect previously queued withdrawals or change the financial withdrawal destination policy.
