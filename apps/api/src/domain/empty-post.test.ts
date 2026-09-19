import Fastify from 'fastify';
import { expect, it } from 'vitest';
it('bodyless membership POST must not declare an empty JSON body', async () => {
  const app = Fastify();
  app.post('/verify', async () => ({ verified: true }));
  try {
    const broken = await app.inject({ method: 'POST', url: '/verify', headers: { 'content-type': 'application/json' } });
    expect(broken.statusCode).toBe(400);
    expect(broken.json().code).toBe('FST_ERR_CTP_EMPTY_JSON_BODY');
    const fixed = await app.inject({ method: 'POST', url: '/verify' });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json().verified).toBe(true);
  } finally { await app.close(); }
});
