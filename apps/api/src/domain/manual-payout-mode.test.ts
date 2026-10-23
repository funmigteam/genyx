import { afterEach, expect, it, vi } from 'vitest';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test', JWT_SECRET: 'x'.repeat(32), TELEGRAM_BOT_TOKEN: 'test', APP_ORIGIN: 'https://example.com' };
const signer = { TONAPI_KEY: 'test', TON_USDC_MASTER_ADDRESS: 'x'.repeat(48), PAYOUT_WALLET_ADDRESS: 'x'.repeat(48), PAYOUT_SIGNING_KEY_FILE: '/tmp/test-only-no-secret' };

async function loadConfig(variables: Record<string, string>) {
  for (const [name, value] of Object.entries({ ...base, ...variables })) vi.stubEnv(name, value);
  vi.resetModules();
  return import('../config.js');
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('keeps payouts manual by default', async () => {
  const config = await loadConfig(signer);
  expect(config.payoutAutomationReady).toBe(false);
});

it('enables automatic payouts only when AUTOMATIC mode is fully configured', async () => {
  const config = await loadConfig({ ...signer, PAYOUT_MODE: 'AUTOMATIC', AUTO_PAYOUT_MAX_USDT: '25.5' });
  expect(config.payoutAutomationReady).toBe(true);
  expect(config.env.AUTO_PAYOUT_MAX_USDT).toBe(25_500_000n);
});

it('refuses to boot in AUTOMATIC mode with a missing signer setting', async () => {
  await expect(loadConfig({ ...signer, PAYOUT_MODE: 'AUTOMATIC', PAYOUT_WALLET_ADDRESS: '' })).rejects.toThrow(/PAYOUT_MODE=AUTOMATIC requires/);
});

it('treats empty optional variables as not configured', async () => {
  const config = await loadConfig({ PLATFORM_TREASURY_ADDRESS: '', RESERVE_WALLET_ADDRESS: '', TONAPI_KEY: '' });
  expect(config.env.PLATFORM_TREASURY_ADDRESS).toBeUndefined();
  expect(config.env.AUTO_PAYOUT_MAX_USDT).toBe(50_000_000n);
});
