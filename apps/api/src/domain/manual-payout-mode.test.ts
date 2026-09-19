import { expect, it, vi } from 'vitest';

it('disables automatic payouts even when deployment still requests AUTOMATIC', async () => {
  const variables = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test', JWT_SECRET: 'x'.repeat(32), TELEGRAM_BOT_TOKEN: 'test', APP_ORIGIN: 'https://example.com', AUTOMATION_ENABLED: 'true', PAYOUT_MODE: 'AUTOMATIC', TONAPI_KEY: 'test', TON_USDC_MASTER_ADDRESS: 'x'.repeat(48), PAYOUT_WALLET_ADDRESS: 'x'.repeat(48), PAYOUT_SIGNING_KEY_FILE: '/tmp/test-only-no-secret' };
  for (const [name, value] of Object.entries(variables)) vi.stubEnv(name, value);
  try { vi.resetModules(); const config = await import('../config.js'); expect(config.payoutAutomationReady).toBe(false); }
  finally { vi.unstubAllEnvs(); vi.resetModules(); }
});
