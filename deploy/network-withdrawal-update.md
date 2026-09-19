# Network, withdrawal and Telegram identity update

Back up the production database before deployment. Apply the pending
`20260909120000_bid_counter` and `20260910010000_telegram_photo` migrations
through the deployment's existing migration workflow before starting the new API.
Do not reset the database or replace production environment/secrets files.

## Behaviour

- New binary settlements match 5 USDT per side and credit 1.50 USDT per cash
  cycle, subject to the existing daily cap, max cap and pool funding checks.
  Every sixth slot is a voucher instead of cash. Existing settled receipts and
  balances are not recalculated. Saved unmatched volume uses the new rule.
- Withdrawals now have a user form in Home and Profile. Minimum is 1 USDT.
  The existing fee model is unchanged: currently 1.5% deducted from USDT, not
  a separate TON fee. The form explicitly displays the fee and net amount.
  A registered, ownership-verified wallet is mandatory. Duplicate submission
  keys reuse the request; pending payouts are not sent twice by the form.
- Automatic payout mode and secrets are unchanged. Auction winner selection
  now runs independently of the payout automation switch, once the bid-only
  counter reaches zero. This does not send a wallet transaction.
- Direct entrants without a sponsor are assigned to the oldest existing
  SUPER_ADMIN. Existing referrals, admin accounts and placed binary roots
  are not reassigned. If no super-admin exists, no default assignment is made.
- Team means all referral descendants, not package purchases. The tree is
  access-controlled and loads branches in pages of 50 members.
- Names/photo URLs synchronize from verified Telegram initData at login.
  If Telegram does not supply a photo, initials are shown.
- Terms acceptance records the content hash in the audit log. Updated terms
  require acceptance of the new version during onboarding.

No real payment or withdrawal is made during local verification.
