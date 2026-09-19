import { z } from 'zod';

export const packageCatalogInput = z.array(z.object({
  code: z.string().trim().min(2).max(32),
  active: z.boolean().default(true),
  economicUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/).refine(value => Number(value) > 0 && Number(value) <= 1000000, 'Price must be between 0 and 1,000,000'),
  gen: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  maxCapUsdt: z.string().regex(/^\d+(\.\d{1,6})?$/).refine(v=>Number(v)>0&&Number(v)<=10000000).optional(),
  discountPercent: z.number().int().min(0).max(99).optional(),
  title: z.string().trim().max(100).optional(),
  description: z.string().trim().max(4000).optional(),
  features: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  terms: z.string().trim().max(4000).optional(),
})).min(1).max(20).refine(items => new Set(items.map(item => item.code)).size === items.length, 'Package codes must be unique');
