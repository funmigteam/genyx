import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { levelForXp } from '../domain/progression.js';

export function supportRoutes(app: FastifyInstance, requireUser: any, requireAdmin: any) {
 app.get('/v1/me/xp-boost',{preHandler:requireUser},async(r:any)=>{
  const purchase=await prisma.shopPurchase.findFirst({where:{userId:r.user.sub,item:{category:'BOOST'},activeUntil:{gt:new Date()}},orderBy:{activeUntil:'desc'}});
  return {active:Boolean(purchase),multiplier:purchase?2:1,expiresAt:purchase?.activeUntil??null};
 });
 app.get('/v1/team-leaderboard',{preHandler:requireUser},async(r:any)=>{
  // Rank teams by total referral descendants, not by private wallet balances.
  const rows=await prisma.$queryRaw<Array<{id:string;members:bigint;rank:bigint}>>`WITH RECURSIVE tree AS (SELECT id AS root,id,ARRAY[id] AS path FROM "User" UNION ALL SELECT t.root,u.id,t.path||u.id FROM tree t JOIN "User" u ON u."referredById"=t.id WHERE NOT u.id=ANY(t.path)), totals AS (SELECT root AS id,count(*) FILTER (WHERE tree.id <> tree.root AND member."activePackageCode" IS NOT NULL) AS members FROM tree JOIN "User" member ON member.id=tree.id GROUP BY root) SELECT id,members,RANK() OVER(ORDER BY members DESC) AS rank FROM totals ORDER BY members DESC,id`;
  const top=rows.slice(0,100),users=await prisma.user.findMany({where:{id:{in:top.map(x=>x.id)}},select:{id:true,publicProfile:true,firstName:true,displayName:true}});
  const format=(row:typeof rows[number])=>({rank:row.rank.toString(),members:row.members.toString(),me:row.id===r.user.sub,name:row.id===r.user.sub?'You':users.find(u=>u.id===row.id)?.publicProfile?(users.find(u=>u.id===row.id)?.displayName||users.find(u=>u.id===row.id)?.firstName||'GENYX user'):'GENYX user'});
  return {rows:top.map(format),me:rows.find(x=>x.id===r.user.sub)?format(rows.find(x=>x.id===r.user.sub)!):null};
 });
 app.get('/v1/admin/withdrawal-switch',{preHandler:requireAdmin},async()=>({enabled:(await prisma.systemSetting.findUnique({where:{key:'withdrawals_enabled'}}))?.value!==false}));
 app.post('/v1/admin/withdrawal-switch',{preHandler:requireAdmin},async(r:any,reply)=>{
  if(r.user.role!=='SUPER_ADMIN')return reply.code(403).send({error:'Super admin required'});
  const {enabled}=z.object({enabled:z.boolean()}).parse(r.body);
  return prisma.$transaction(async tx=>{await tx.systemSetting.upsert({where:{key:'withdrawals_enabled'},create:{key:'withdrawals_enabled',value:enabled},update:{value:enabled}});await tx.auditEvent.create({data:{actorId:r.user.sub,action:'WITHDRAWAL_SWITCH_CHANGED',entityType:'SystemSetting',entityId:'withdrawals_enabled',after:{enabled}}});return {enabled};});
 });
 app.post('/v1/admin/announcements',{preHandler:requireAdmin},async(r:any,reply)=>{
  if(r.user.role!=='SUPER_ADMIN')return reply.code(403).send({error:'Super admin required'});
  const body=z.object({title:z.string().trim().min(1).max(120),body:z.string().trim().min(1).max(2000),requestKey:z.string().uuid()}).parse(r.body);
  return prisma.$transaction(async tx=>{
   const users=await tx.user.findMany({select:{id:true}});
   const result=await tx.userNotification.createMany({data:users.map(u=>({userId:u.id,eventKey:`announcement:${body.requestKey}:${u.id}`,title:body.title,body:body.body})),skipDuplicates:true});
   await tx.auditEvent.create({data:{actorId:r.user.sub,action:'ANNOUNCEMENT_SENT',entityType:'UserNotification',entityId:body.requestKey,after:{title:body.title,count:result.count}}});return result;
  },{timeout:30000});
 });
 app.get('/v1/me/tickets', {preHandler:requireUser}, async(r:any)=>prisma.supportTicket.findMany({where:{userId:r.user.sub},orderBy:{createdAt:'desc'},take:100}));
 app.post('/v1/me/tickets', {preHandler:requireUser}, async(r:any)=>{
  const body=z.object({subject:z.string().trim().min(3).max(150),body:z.string().trim().min(5).max(4000)}).parse(r.body);
  return prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${r.user.sub} FOR UPDATE`;
   if(await tx.supportTicket.count({where:{userId:r.user.sub,createdAt:{gte:new Date(Date.now()-86400000)}}})>=5) throw new Error('You can create up to five tickets per day.');
   return tx.supportTicket.create({data:{...body,userId:r.user.sub}});
  });
 });
 app.get('/v1/admin/tickets',{preHandler:requireAdmin},async()=>prisma.supportTicket.findMany({orderBy:{updatedAt:'desc'},take:200}));
 app.post('/v1/admin/tickets/:id/reply',{preHandler:requireAdmin},async(r:any)=>{
  const body=z.object({reply:z.string().trim().min(1).max(4000),status:z.enum(['ANSWERED','CLOSED'])}).parse(r.body);
  return prisma.$transaction(async tx=>{
   const ticket=await tx.supportTicket.update({where:{id:r.params.id},data:body});
   await tx.userNotification.create({data:{userId:ticket.userId,eventKey:`ticket:${ticket.id}:${crypto.randomUUID()}`,title:'Support replied',body:`Your ticket “${ticket.subject}” has a reply. Open Support to read it.`}});
   await tx.auditEvent.create({data:{actorId:r.user.sub,action:'SUPPORT_REPLIED',entityType:'SupportTicket',entityId:ticket.id,after:body}});
   return ticket;
  });
 });
 app.get('/v1/me/notifications',{preHandler:requireUser},async(r:any)=>{
  const user=await prisma.user.findUniqueOrThrow({where:{id:r.user.sub}});
  const level=levelForXp(user.xp).level;
  if(level>1)await prisma.userNotification.upsert({where:{eventKey:`level:${user.id}:${level}`},create:{userId:user.id,eventKey:`level:${user.id}:${level}`,title:`Level ${level} unlocked`,body:`Your account has reached level ${level}. Keep completing tasks to earn XP.`},update:{}});
  return prisma.userNotification.findMany({where:{userId:user.id},orderBy:{createdAt:'desc'},take:100});
 });
 app.post('/v1/me/notifications/:id/read',{preHandler:requireUser},async(r:any)=>prisma.userNotification.updateMany({where:{id:r.params.id,userId:r.user.sub,readAt:null},data:{readAt:new Date()}}));
}
