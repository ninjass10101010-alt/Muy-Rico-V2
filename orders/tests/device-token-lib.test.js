import { describe, it, expect } from 'vitest';
import {
  generateDeviceToken, hashToken,
  mintDeviceToken, resolveDeviceToken, listDevices,
  revokeDevice, revokeAllDevices,
} from '../workers/device-token-lib.js';

// Minimal fake D1 that interprets exactly the SQL this library issues.
function makeFakeDb() {
  const tokens = [];
  let seq = 1;
  const now = () => new Date().toISOString();
  const ok = { meta: { changes: 1 } };
  const bind = (sql, vals) => {
    const up = sql.toUpperCase();
    if (up.includes('INSERT INTO DEVICE_TOKENS')) {
      const [user_email, token_hash, label, expires_at] = vals;
      const row = { id: seq++, user_email, token_hash, label, created_at: now(), last_used_at: now(), expires_at, revoked: 0 };
      tokens.push(row);
      return { run: async () => ok, first: async () => row, all: async () => ({ results: [] }) };
    }
    if (up.includes('SELECT COUNT(*)')) {
      const c = tokens.filter((r) => r.user_email === vals[0] && !r.revoked).length;
      return { run: async () => ({ meta: { changes: 0 } }), first: async () => ({ c }), all: async () => ({ results: [] }) };
    }
    if (up.startsWith('SELECT ID, USER_EMAIL')) {
      const row = tokens.find((r) => r.token_hash === vals[0] && !r.revoked) || null;
      return { run: async () => ({ meta: { changes: 0 } }), first: async () => row, all: async () => ({ results: [] }) };
    }
    if (up.startsWith('SELECT ID, LABEL')) {
      const results = tokens.filter((r) => r.user_email === vals[0] && !r.revoked).sort((a, b) => b.id - a.id);
      return { run: async () => ({ meta: { changes: 0 } }), first: async () => null, all: async () => ({ results }) };
    }
    if (up.startsWith('UPDATE DEVICE_TOKENS SET LAST_USED_AT')) {
      const row = tokens.find((r) => r.id === vals[1]);
      if (row) { row.last_used_at = now(); row.expires_at = vals[0]; }
      return { run: async () => ({ meta: { changes: row ? 1 : 0 } }), first: async () => null, all: async () => ({ results: [] }) };
    }
    if (up.startsWith('UPDATE DEVICE_TOKENS SET REVOKED = 1 WHERE ID')) {
      const row = tokens.find((r) => r.id === vals[0] && r.user_email === vals[1] && !r.revoked);
      if (row) row.revoked = 1;
      return { run: async () => ({ meta: { changes: row ? 1 : 0 } }), first: async () => null, all: async () => ({ results: [] }) };
    }
    if (up.startsWith('UPDATE DEVICE_TOKENS SET REVOKED = 1 WHERE USER_EMAIL')) {
      tokens.forEach((r) => { if (r.user_email === vals[0] && !r.revoked) r.revoked = 1; });
      return { run: async () => ok, first: async () => null, all: async () => ({ results: [] }) };
    }
    if (up.includes('DELETE FROM DEVICE_TOKENS') && up.includes('ID NOT IN')) {
      // Per-email active-cap eviction: keep the newest `limit` active tokens.
      const [email, , limit] = vals;
      const active = tokens.filter((r) => r.user_email === email && !r.revoked).sort((a, b) => b.id - a.id);
      const keep = new Set(active.slice(0, limit).map((r) => r.id));
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].user_email === email && !tokens[i].revoked && !keep.has(tokens[i].id)) {
          tokens.splice(i, 1);
        }
      }
      return { run: async () => ok, first: async () => null, all: async () => ({ results: [] }) };
    }
    // Other DELETE hygiene statements are no-ops in the fake.
    return { run: async () => ({ meta: { changes: 0 } }), first: async () => null, all: async () => ({ results: [] }) };
  };
  return { prepare: (sql) => ({ bind: (...v) => bind(sql, v) }), tokens };
}

describe('generateDeviceToken', () => {
  it('is url-safe base64 and unique', () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('is deterministic 64-char hex', async () => {
    const h = await hashToken('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken('abc')).toBe(h);
    expect(await hashToken('abd')).not.toBe(h);
  });
});

describe('mint + resolve + revoke', () => {
  it('mints a token that resolves to its email and rolls expiry', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const { token, expiresAt } = await mintDeviceToken(env, 'jeff@example.com', 'iPhone · Safari');
    expect(token).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const record = await resolveDeviceToken(env, token);
    expect(record.email).toBe('jeff@example.com');
  });

  it('rejects an unknown token', async () => {
    const db = makeFakeDb();
    expect(await resolveDeviceToken({ DB: db }, 'nope')).toBeNull();
  });

  it('revoking a token invalidates it', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const { token } = await mintDeviceToken(env, 'bex@example.com', 'Pixel');
    const record = await resolveDeviceToken(env, token);
    expect(await revokeDevice(env, 'bex@example.com', record.id)).toBe(true);
    expect(await resolveDeviceToken(env, token)).toBeNull();
  });

  it('revokeAllDevices invalidates every token for the email', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const a = await mintDeviceToken(env, 'jeff@example.com', 'a');
    const b = await mintDeviceToken(env, 'jeff@example.com', 'b');
    await revokeAllDevices(env, 'jeff@example.com');
    expect(await resolveDeviceToken(env, a.token)).toBeNull();
    expect(await resolveDeviceToken(env, b.token)).toBeNull();
  });

  it('caps active tokens per email at 10', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    for (let i = 0; i < 12; i++) await mintDeviceToken(env, 'jeff@example.com', `d${i}`);
    const devices = await listDevices(env, 'jeff@example.com');
    expect(devices.length).toBe(10);
  });

  it("listDevices returns only the caller email's active tokens", async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    await mintDeviceToken(env, 'jeff@example.com', 'jeff-phone');
    await mintDeviceToken(env, 'bex@example.com', 'bex-phone');
    expect((await listDevices(env, 'bex@example.com')).map((d) => d.label)).toEqual(['bex-phone']);
  });
});
