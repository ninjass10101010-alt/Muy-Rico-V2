import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

// Minimal D1 stub for read routes.
function makeEnv(extra = {}) {
  const db = {
    prepare() {
      const stmt = {
        bind() { return stmt; },
        async first() { return null; },
        async run() { return { meta: {} }; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return { DB: db, ...extra };
}
const ctx = { waitUntil: () => {} };

const customersReq = (headers = {}) =>
  new Request('https://orders-api.test/api/customers', { method: 'GET', headers });

describe('auth hardening (Access JWT)', () => {
  it('rejects a forged email header when hardening is configured', async () => {
    const env = makeEnv({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-1' });
    const res = await worker.fetch(
      customersReq({ 'cf-access-authenticated-user-email': 'jeffery.garcia1@icloud.com' }),
      env, ctx
    );
    expect(res.status).toBe(401);
  });

  it('rejects a forged (unsigned) CF_Authorization cookie when hardening is configured', async () => {
    const env = makeEnv({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-1' });
    // header.payload.signature with a made-up signature
    const forged = 'aaa.' + btoa(JSON.stringify({ email: 'attacker@evil.com' })) + '.bbb';
    const res = await worker.fetch(
      customersReq({ Cookie: `CF_Authorization=${forged}` }),
      env, ctx
    );
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated access when hardening is configured', async () => {
    const env = makeEnv({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-1' });
    const res = await worker.fetch(customersReq(), env, ctx);
    expect(res.status).toBe(401);
  });

  it('still allows the legacy header when hardening is NOT configured', async () => {
    const env = makeEnv(); // no ACCESS_TEAM_DOMAIN / ACCESS_AUD
    const res = await worker.fetch(
      customersReq({ 'cf-access-authenticated-user-email': 'owner@example.com' }),
      env, ctx
    );
    expect(res.status).not.toBe(401);
  });
});
