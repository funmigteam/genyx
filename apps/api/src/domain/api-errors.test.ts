import Fastify from 'fastify';
import {it,expect} from 'vitest';
import {z} from 'zod';
import {ApiError,installApiErrors} from './api-errors.js';
it('returns a useful reset conflict instead of 500',async()=>{const app=Fastify();installApiErrors(app);app.get('/test',async()=>{throw new ApiError(409,'PENDING_TASK_CLAIMS','3 pending claims');});const r=await app.inject('/test');expect(r.statusCode).toBe(409);expect(r.json().code).toBe('PENDING_TASK_CLAIMS');await app.close();});
it('reports invalid inputs without leaking internal errors',async()=>{const app=Fastify();installApiErrors(app);app.get('/test',async()=>z.object({name:z.string()}).parse({}));expect((await app.inject('/test')).statusCode).toBe(422);await app.close();});
it('returns expected domain rejections as actionable validation errors',async()=>{const app=Fastify();installApiErrors(app);app.get('/test',async()=>{throw Error('Daily withdrawal limit reached');});const r=await app.inject('/test');expect(r.statusCode).toBe(422);expect(r.json()).toMatchObject({code:'OPERATION_REJECTED',error:'Daily withdrawal limit reached'});await app.close();});
it('redacts unexpected exception details and supplies a reference',async()=>{const app=Fastify();installApiErrors(app);app.get('/test',async()=>{throw Error('private database details');});const r=await app.inject('/test');expect(r.statusCode).toBe(500);expect(r.body).not.toContain('private database');expect(r.json().requestId).toBeTruthy();await app.close();});
