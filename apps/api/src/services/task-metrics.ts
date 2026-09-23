import { Prisma } from '@prisma/client';
export const metricKinds=['LOTTERY_BID_COUNT','BINARY_AMOUNT','SHOP_BOOST_COUNT','SHOP_PROFILE_COUNT','SHOP_TIME_COUNT','DIRECT_COUNT','MAX_CAP_REACHED','USED_CAP_REACHED','SEASON_REACHED','CYCLES_REACHED','VOUCHERS_REACHED','GEN_SPENT','DAY_REACHED'];
export async function checkMetric(tx:Prisma.TransactionClient,userId:string,kind:string,target:number){
 const user=await tx.user.findUniqueOrThrow({where:{id:userId}});let value=0n;let required=BigInt(target);
 if(kind==='MAX_CAP_REACHED'){value=user.maxCap;required*=1000000n;}
 if(kind==='USED_CAP_REACHED'){value=user.capConsumed;required*=1000000n;}
 if(kind==='GEN_SPENT')value=user.genSpent;
 if(kind==='LOTTERY_BID_COUNT')value=BigInt(await tx.auctionBid.count({where:{userId}}));
 if(kind==='VOUCHERS_REACHED')value=BigInt(user.vouchers);
 if(kind==='DIRECT_COUNT')value=BigInt(await tx.user.count({where:{referredById:userId,activePackageCode:{not:null}}}));
 if(kind.startsWith('SHOP_'))value=BigInt(await tx.shopPurchase.count({where:{userId,item:{category:kind==='SHOP_BOOST_COUNT'?'BOOST':kind==='SHOP_PROFILE_COUNT'?'PROFILE':'TIME'}}}));
 if(kind==='SEASON_REACHED'||kind==='DAY_REACHED'){const season=await tx.seasonEnrollment.findFirst({where:{userId,currentDay:{gt:0}},orderBy:{season:'desc'}});value=BigInt(kind==='SEASON_REACHED'?season?.season??0:season?.currentDay??0);}
 if(kind==='BINARY_AMOUNT'){value=(await tx.binaryReceipt.aggregate({where:{userId},_sum:{credited:true}}))._sum.credited??0n;required*=1000000n;}
 if(kind==='CYCLES_REACHED'){const p=await tx.binaryPosition.findUnique({where:{userId}});const vouchers=(await tx.binaryReceipt.aggregate({where:{userId},_sum:{vouchers:true}}))._sum.vouchers??0;value=(p?.slots??0n)-BigInt(vouchers);}
 return value>=required;
}
