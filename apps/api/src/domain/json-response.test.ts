import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { jsonResponse } from './json-response.js';
it('serializes nested financial integers exactly in API responses', async () => {
  const app = Fastify();
  app.addHook('preSerialization', async (_request, _reply, payload) => jsonResponse(payload));
  app.get('/', async () => ({ rows: [{ amount: 900719925474099300n, count: 2 }], date: new Date('2026-01-01'), missing: null }));
  try {
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rows: [{ amount: '900719925474099300', count: 2 }], date: '2026-01-01T00:00:00.000Z', missing: null });
  } finally { await app.close(); }
});
