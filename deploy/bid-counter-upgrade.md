# Bid-only auction counter

The Auction.remainingSeconds column is required before starting the new API.
Apply migration 20260909120000_bid_counter using the deployment's migration
workflow after backing up the database. Do not reset the database.

The migration preserves existing room records and converts the former configured
duration (including previous bid deductions) into a fixed counter. Open rooms
receive at least one remaining second. Closed/awaiting rooms receive zero.
Using db push alone instead gives existing rooms the default 86400 counter;
use the migration SQL to preserve their configured durations.

Each accepted bid deducts one second atomically with its GEN charge. Duplicate
request keys do not deduct again. Wall-clock time does not close an open room.
The auctions worker selects zero-counter rooms for winner selection. The winner's
24-hour payment deadline still uses real elapsed time. No payout/environment
settings are changed by this update.

The admin UI retains lowest-unique-bid rooms only. Legacy random-draw records
and endpoints remain intact for historical compatibility; their creation form
has been removed from the admin UI.
