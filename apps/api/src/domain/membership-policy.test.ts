import { it,expect } from 'vitest';
import { requiresMembership } from './membership-policy.js';
it('gates participation without withholding access to funds or onboarding',()=>{
  for(const path of ['/v1/tasks/x/claim','/v1/shop/x/purchase','/v1/auctions/x/bids','/v1/payments/package-intents'])expect(requiresMembership('POST',path)).toBe(true);
  for(const path of ['/v1/onboarding/verify','/v1/withdrawals','/v1/payments/x/transaction','/v1/wallets/verify'])expect(requiresMembership('POST',path)).toBe(false);
  expect(requiresMembership('GET','/v1/tasks/x/claim')).toBe(false);
});
