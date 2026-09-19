import {it,expect,vi} from 'vitest';
const findMany=vi.hoisted(()=>vi.fn());
vi.mock('../prisma.js',()=>({prisma:{systemSetting:{findMany}}}));
import {readPackagePricing} from './package-pricing.js';
it('uses admin cap and discount with a fixed owner allocation',async()=>{
 findMany.mockResolvedValue([{key:'package_prices',value:[{code:'BRONZE',economicUsdc:'11',gen:100,maxCapUsdt:'95',discountPercent:20}]}]);
 const [p]=await readPackagePricing();expect(p.economicUsdc).toBe('9.000000');expect(p.maxCapUsdt).toBe('95');expect(p.regularUsdc).toBe('11.000000');expect(p.appliedDiscountPercent).toBe(20);
 const [admin]=await readPackagePricing(false);expect(admin.economicUsdc).toBe('11.000000');expect(admin.discountPercent).toBe(20);
});
it('allows admin to disable opening discounts explicitly',async()=>{
 findMany.mockResolvedValue([{key:'package_prices',value:[{code:'BRONZE',economicUsdc:'11',gen:100,discountPercent:0}]}]);
 const [p]=await readPackagePricing();expect(p.economicUsdc).toBe('11.000000');expect(p.maxCapUsdt).toBe('70');
});
