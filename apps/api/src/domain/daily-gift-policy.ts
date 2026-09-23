import { z } from 'zod';
export const dailyGiftRewardInput = z.object({
  enabled: z.boolean(),
  usdt: z.string().regex(/^\d{1,7}(\.\d{1,6})?$/),
  gen: z.number().int().min(0).max(1000000),
  xp: z.number().int().min(0).max(1000000),
});
export const dailyGiftPolicyInput = dailyGiftRewardInput.extend({
  days: z.record(dailyGiftRewardInput).default({}).refine(days => Object.keys(days).every(key => /^(?:[1-9]|[12]\d|30)$/.test(key)), 'Day must be between 1 and 30'),
});
