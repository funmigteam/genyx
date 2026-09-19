import {it,expect,vi,beforeEach} from 'vitest';
import Fastify from 'fastify';
const db=vi.hoisted(()=>({supportTicket:{findMany:vi.fn()},userNotification:{updateMany:vi.fn()},user:{findUniqueOrThrow:vi.fn()}}));
vi.mock('../prisma.js',()=>({prisma:db}));
import {supportRoutes} from './support-routes.js';
beforeEach(()=>vi.resetAllMocks());
it('limits ticket listing to authenticated user',async()=>{
 const app=Fastify();supportRoutes(app,async(r:any)=>{r.user={sub:'alice'};},async()=>{});
 db.supportTicket.findMany.mockResolvedValue([]);
 const response=await app.inject({url:'/v1/me/tickets'});expect(response.statusCode).toBe(200);expect(db.supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'alice'}}));await app.close();
});
it('scopes read receipts to the notification owner',async()=>{
 const app=Fastify();supportRoutes(app,async(r:any)=>{r.user={sub:'alice'};},async()=>{});db.userNotification.updateMany.mockResolvedValue({count:0});
 await app.inject({method:'POST',url:'/v1/me/notifications/other/read'});expect(db.userNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'other',userId:'alice',readAt:null}}));await app.close();
});
it('requires administrator access for the ticket inbox',async()=>{
 const app=Fastify();supportRoutes(app,async()=>{},async(_r:any,reply:any)=>reply.code(403).send({error:'Forbidden'}));
 expect((await app.inject({url:'/v1/admin/tickets'})).statusCode).toBe(403);expect(db.supportTicket.findMany).not.toHaveBeenCalled();await app.close();
});
