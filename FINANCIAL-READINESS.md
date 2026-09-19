# Financial implementation status

This source is not yet approved for unattended production payouts.

## Changes implemented

- Deposit worker now scans treasury transactions in ascending logical-time pages with a persisted network/treasury/master cursor, matches invoice comments and authentic jetton notifications, and invokes payment settlement without manual hash submission. It does not advance past a settlement failure. Out-of-window payments are audited. API build and 53 unit tests passed; the new scanning path has not been exercised against a live provider. Per-invoice immutable address snapshots and reconciliation of blocked invoices remain required.

- Ledger writes reject negative/double-sided entries, mixed currencies, missing accounts and conflicting idempotency retries. Reordered identical entries remain idempotent. PostgreSQL tests cover these checks. Authenticated requests reload current roles; newly issued JWTs expire after one hour. Role changes and package pricing are audited atomically; package financial settings require super-admin approval. All 63 API tests passed with isolated PostgreSQL.

- User Activity now includes season gift/grace controls, owned/queued seasons and paid-season intents. Lottery navigation now uses the new auction endpoints, bid forms, winner payment intents and transaction submission. Super-admin UI includes funded auction creation, season pricing and task-approval queue. Accessible labels, busy states and responsive styles were added using the UI/UX skill; browser/Telegram visual and end-to-end checks are still outstanding. Payments still require submitting the on-chain hash; this is not automatic deposit discovery.

- Payout outbox now saves signed BOC, identity and validity before broadcasting. Recovery retries those exact bytes, never re-signs an ambiguous send, and can requeue versioned jobs interrupted before persistence. Expired/legacy ambiguous jobs still require reconciliation. Provider errors are not stored verbatim. Mainnet/testnet V5 wallet identity is selected explicitly. Unit tests exercise identical-byte retry and malformed/expired/mismatched-message rejection.
- Submitted-payment verification now inspects actual transfer notifications from the recipient jetton wallet derived from the configured master, matching recipient, exact amount and invoice payload and rejecting emulation/bounces. Unit tests cover inline/reference payloads and mismatches; live provider integration and stable per-invoice address snapshots remain required. 60 API tests and API build passed locally.

- Separate auction backend now reserves USDT before opening, debits GEN per idempotent bid, reduces deadline by one second, selects the lowest unique bid (or lowest exactly-double bid shared between distinct users), gives winners 24 hours, and advances expired offers. Confirmed bid payments release reserved prizes through capped reward accounting and credit configured GEN/XP exactly once. No eligible bidders sends remaining escrow to owner. Automatic package purchase from prizes remains disabled. The legacy lottery UI/routes have NOT yet been replaced by these auction endpoints; do not present the old random lottery as this implementation.
- Auction integration tests cover retry/deadline handling, next-bidder expiry, payment/prize replay, cap retention, double winners and no-qualified-bid owner allocation. 53 API tests passed in isolated PostgreSQL; API build passed. No blockchain transfers were performed.

- First package confirmation enrolls free season one once. Season-day records snapshot required tasks, roll over at Tehran noon, enforce verified completion before gift claim, apply package gift/reset limits, and support user-selected per-season Grace Days. A 24-hour TIME shop item extends both the active day and season deadline atomically with the purchase; legacy 30-minute items fail closed. Boost purchases are disabled. Season progress now derives from completed days, not XP modulo. Positive gift settlement and retries, missed days, extension and Grace Day limits were tested in isolated PostgreSQL (50 API tests passing, API build passing).
- Paid-season intents and confirmation now snapshot configurable prices, allocate 10% owner / 90% reward without package GEN or cap changes, reject repurchase, and queue the next season until the current season ends. Eligibility requires 50% completion of the preceding season. Confirmation is routed through the existing submitted-payment verification path, whose chain-verification limitations below remain release blockers. PostgreSQL tests cover immutable pending quotes, repeated confirmation, split ledger entries and queued activation (51 API tests passing, API build passing).
- End-of-season rewards, frontend season controls and historical enrollment migration still need implementation/review. The season worker is controlled by AUTOMATION_ENABLED; production was not modified.

- Shared reward service locks pool and user, checks pool solvency and remaining cap, writes an idempotent receipt (including fully capped rewards), and credits USDT with cap consumption atomically. Bounded retries handle rolled-back serialization/deadlock failures, including raw-query SQLSTATE errors. Tasks and binary settlements now use this service; seasons and auctions still require integration.
- Task claims snapshot GEN/XP/USDT (USDT input is atomic units, six decimals), apply package multipliers and await verification except daily check-in. Super-admin approval commits all rewards and audit together. Historical claims without snapshots fail closed; deletion archives tasks to preserve claims.
- Confirmed purchases place binary positions and propagate paid base volume to all ancestors idempotently. The automatic binary worker consumes matched volume, credits funded/capped USDT, issues every sixth slot as a voucher, and records daily-cap flush-out. Heavy-side lifetime and available volumes are distinct. Historical purchases are NOT automatically backfilled; tree placement and migration need production review before deployment.
- Local isolated PostgreSQL integration tests passed for duplicate requests, conflicting retries, insufficient liquidity rollback, concurrent rewards constrained by max cap, task approval snapshots, binary 60/60 settlement and daily-cap flush-out. All 49 API tests and the API TypeScript build passed. This does not validate production or blockchain transfers.

- New orders snapshot owner/binary/reward allocations and cap. Confirmation posts pool allocations and increments cap within the same transaction as GEN credit and binary volume propagation. Missing historical snapshots fail closed. Legacy GEN referral credit was removed from confirmation.

- Version 2 calculations cover approved package splits, discount-preserved GEN/cap, binary 60/60 = 15 USDT plus one voucher, Tehran noon, free season one and auction winner selection. Binary and task-day calculations are connected; opening-price, season and auction lifecycle integrations remain outstanding. Super-admin preview endpoints expose calculations without ledger mutations.

- Package GEN is captured on new payment intents (`Payment.quotedGen`) and credited in the confirmation transaction. Payment-row locking serializes concurrent confirmations. Existing pending payments without a quote require reconciliation, not automatic repricing.

- Shared progressive XP curve for withdrawal caps; the final cap requires completion of level 30.
- Withdrawal retries reject conflicting user, amount or destination.
- Serializable ledger settlement records gross hold debit, net payout and fee.
- A database advisory lock serializes payout selection and withdrawal review.
- Only one unresolved payout is allowed. SENDING or MANUAL_REVIEW blocks further sends.
- External message hash is saved before broadcast; ambiguous broadcasts are not re-signed.
- Automatic settlement requires an actual, non-emulated matching transfer notification from the recipient jetton wallet derived from the configured master.
- Admin financial views read server reports, payments and withdrawals, with CSV export.

## Release blockers / remaining work

- Integration tests against PostgreSQL for concurrency, crash recovery and ledger balances.
- Controlled blockchain end-to-end tests, including failed transfers, indexing delays and insufficient gas.
- Signed-message outbox is implemented; complete reconciliation tooling and real network crash/recovery verification remain required. Expired ambiguity intentionally stops the queue.
- Existing jobs created before deterministic query IDs must be reconciled separately; do not reset or re-send them.
- Automatic deposit discovery is implemented with a persisted cursor; live-provider pagination/restart verification and operator reconciliation for failed settlements remain required.
- Refund workflows, reserve/treasury rebalancing, multi-stage approvals and complete financial policy editing remain incomplete.
- Historical PAID withdrawals must be audited separately for missing ledger settlement. Do not replay payments to repair accounting.
- Full admin CRUD, role enforcement audit, automatic lottery scheduling and notifications are not complete.
- Seed phrases previously exposed in chat/screenshots must not be funded or used in production.

No production environment variables, server files or wallet funds were changed by this local implementation.
