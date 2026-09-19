import { z } from 'zod';
export const dailyGiftPolicyInput = z.object({
  enabled: z.boolean(),
  usdt: z.string().regex(/^\d{1,7}(\.\d{1,6})?$/),
  gen: z.number().int().min(0).max(1000000),
  xp: z.number().int().min(0).max(1000000),
});
