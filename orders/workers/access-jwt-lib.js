// Cloudflare Access JWT verification (RS256) via the team's public JWKS.
// Pure + injectable (fetchImpl/now) so it can be unit-tested without a live team.
//
// The API must never trust identity by header presence or by decoding an
// unsigned cookie — anyone can forge those. This module verifies the signature
// of the Access assertion against the team's published certs and validates
// iss/aud/exp before returning the email.

const DEFAULT_TTL_MS = 60 * 60 * 1000; // cache JWKS for 1h

// Per-isolate JWKS cache (ephemeral by design; a miss just refetches).
const jwksCache = new Map(); // teamDomain -> { keys, fetchedAt }

function b64urlToBytes(b64url) {
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4));
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(b64url) {
  return new TextDecoder().decode(b64urlToBytes(b64url));
}

async function getJwks(teamDomain, fetchImpl, now, ttlMs) {
  const cached = jwksCache.get(teamDomain);
  if (cached && now - cached.fetchedAt < ttlMs) return cached.keys;
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const data = await res.json();
  const keys = data.keys || data.public_certs || [];
  jwksCache.set(teamDomain, { keys, fetchedAt: now });
  return keys;
}

/**
 * Verify a Cloudflare Access JWT.
 * @returns the authenticated email, or null if the token is absent/invalid.
 */
export async function verifyAccessJwt({
  token,
  teamDomain,
  aud,
  fetchImpl = fetch,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  if (!token || !teamDomain || !aud) return null;

  const parts = String(token).split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch {
    return null;
  }

  // Pin the algorithm — never accept "none" or an HMAC downgrade.
  if (header.alg !== 'RS256') return null;

  // Issuer must be the exact configured team (blocks iss-injection to another team).
  if (payload.iss !== `https://${teamDomain}`) return null;

  const audClaim = payload.aud;
  const audOk = Array.isArray(audClaim) ? audClaim.includes(aud) : audClaim === aud;
  if (!audOk) return null;

  if (typeof payload.exp === 'number' && payload.exp * 1000 < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now + 60_000) return null;

  let keys;
  try {
    keys = await getJwks(teamDomain, fetchImpl, now, ttlMs);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid && k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk || !jwk.n || !jwk.e) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty || 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch {
    return null;
  }

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1])
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  return typeof payload.email === 'string' && payload.email ? payload.email : null;
}

export function _clearJwksCache() {
  jwksCache.clear();
}
