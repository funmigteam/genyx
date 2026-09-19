import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(), REDIS_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32), TELEGRAM_BOT_TOKEN: z.string().min(1),
  APP_ORIGIN: z.string().url(), PORT: z.coerce.number().default(3001),
  ADMIN_TELEGRAM_IDS: z.string().optional(), TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  TONAPI_KEY: z.string().min(1).optional(),
  TON_USDC_MASTER_ADDRESS: z.string().min(20).optional(),
  PLATFORM_TREASURY_ADDRESS: z.string().min(20).optional(),
  PAYOUT_WALLET_ADDRESS: z.string().min(20).optional(),
  RESERVE_WALLET_ADDRESS: z.string().min(20).optional(),
  PAYOUT_SIGNING_KEY_FILE: z.string().min(1).optional(),
  TON_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  AUTOMATION_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  AUTOMATION_POLL_INTERVAL_MS: z.coerce.number().int().min(15_000).max(300_000).default(30_000),
  PAYOUT_MODE: z.enum(['MANUAL', 'AUTOMATIC']).default('MANUAL')
});
export const env = envSchema.parse(process.env);
// Manual-only release: never broadcast withdrawals, even with a stale production env.
export const payoutAutomationReady: boolean = false;
export const bootstrapAdminTelegramIds = new Set(
  (env.ADMIN_TELEGRAM_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean)
);

// Economics belongs in SystemSetting after the first migration. These safe defaults
// are only used to seed settings and never accepted from clients.
export const economics = {
  timezone: 'Europe/Istanbul', dailyResetHour: 12,
  withdrawal: { minimumUsdc: 1_000_000n, feeBps: 150, maximumPerDay: 2 },
  packages: [
    { code: 'BRONZE', economic: 10_000_000n, ownerPool: 1_000_000n, gen: 100n },
    { code: 'SILVER', economic: 30_000_000n, ownerPool: 3_000_000n, gen: 310n },
    { code: 'GOLD', economic: 100_000_000n, ownerPool: 10_000_000n, gen: 1030n },
    { code: 'PLATINUM', economic: 300_000_000n, ownerPool: 30_000_000n, gen: 3100n },
    { code: 'DIAMOND', economic: 1_000_000_000n, ownerPool: 100_000_000n, gen: 10400n }
  ]
} as const;
