import { describe, it, expect, beforeEach } from 'vitest';
import { verifyAccessJwt, _clearJwksCache } from '../workers/access-jwt-lib.js';

const TEAM = 'muyrico.cloudflareaccess.com';
const AUD = 'aud-tag-123';

function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
}

async function signJwt(privateKey, headerObj, payloadObj) {
  const h = b64urlJson(headerObj);
  const p = b64urlJson(payloadObj);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

async function jwkFor(publicKey, kid) {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

const fetchReturning = (keys) => async () => ({ ok: true, json: async () => ({ keys }) });

let keyPair, jwks, fetchImpl;
const basePayload = () => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  email: 'owner@example.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

beforeEach(async () => {
  _clearJwksCache();
  keyPair = await makeKeyPair();
  jwks = [await jwkFor(keyPair.publicKey, 'kid-1')];
  fetchImpl = fetchReturning(jwks);
});

describe('verifyAccessJwt', () => {
  it('accepts a validly signed token and returns the email', async () => {
    const token = await signJwt(keyPair.privateKey, { alg: 'RS256', kid: 'kid-1' }, basePayload());
    const email = await verifyAccessJwt({ token, teamDomain: TEAM, aud: AUD, fetchImpl });
    expect(email).toBe('owner@example.com');
  });

  it('rejects a token with a tampered payload', async () => {
    const token = await signJwt(keyPair.privateKey, { alg: 'RS256', kid: 'kid-1' }, basePayload());
    const [h, , s] = token.split('.');
    const forged = b64urlJson({ ...basePayload(), email: 'attacker@evil.com' });
    // Same header + signature, different payload → signature no longer matches.
    expect(await verifyAccessJwt({ token: `${h}.${forged}.${s}`, teamDomain: TEAM, aud: AUD, fetchImpl })).toBeNull();
  });

  it('rejects a token signed by a different key', async () => {
    const other = await makeKeyPair();
    const token = await signJwt(other.privateKey, { alg: 'RS256', kid: 'kid-1' }, basePayload());
    expect(await verifyAccessJwt({ token, teamDomain: TEAM, aud: AUD, fetchImpl })).toBeNull();
  });

  it('rejects a wrong audience', async () => {
    const token = await signJwt(keyPair.privateKey, { alg: 'RS256', kid: 'kid-1' }, basePayload());
    expect(await verifyAccessJwt({ token, teamDomain: TEAM, aud: 'some-other-app', fetchImpl })).toBeNull();
  });

  it('rejects a wrong issuer (iss-injection)', async () => {
    const payload = { ...basePayload(), iss: 'https://evil.cloudflareaccess.com' };
    const token = await signJwt(keyPair.privateKey, { alg: 'RS256', kid: 'kid-1' }, payload);
    expect(await verifyAccessJwt({ token, teamDomain: TEAM, aud: AUD, fetchImpl })).toBeNull();
  });

  it('rejects an expired token', async () => {
    const payload = { ...basePayload(), exp: Math.floor(Date.now() / 1000) - 10 };
    const token = await signJwt(keyPair.privateKey, { alg: 'RS256', kid: 'kid-1' }, payload);
    expect(await verifyAccessJwt({ token, teamDomain: TEAM, aud: AUD, fetchImpl })).toBeNull();
  });

  it('rejects an alg:none token', async () => {
    const h = b64urlJson({ alg: 'none', kid: 'kid-1' });
    const p = b64urlJson(basePayload());
    const token = `${h}.${p}.`;
    expect(await verifyAccessJwt({ token, teamDomain: TEAM, aud: AUD, fetchImpl })).toBeNull();
  });

  it('returns null when hardening is not configured', async () => {
    const token = await signJwt(keyPair.privateKey, { alg: 'RS256', kid: 'kid-1' }, basePayload());
    expect(await verifyAccessJwt({ token, teamDomain: '', aud: '', fetchImpl })).toBeNull();
  });
});
